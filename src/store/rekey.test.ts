// S-24：id のつけ替え（rekeyJob）・copyJob・addJobs（第2.4版。architecture.md 16.3）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { frozenDemand, frozenSheetViews } from '../engine/progress/frozen'
import type { Job } from '../engine/types'
import { copyJob, rekeyJob, setPieceCheck, type OpResult } from './jobs'
import { initialState, storeReducer } from './reducer'
import { sampleFromTemplate } from './sample'
import { defaultTemplate } from './template'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const unwrap = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
/** 決まった id を順に作る */
function counter() {
  let i = 0
  return (prefix: string) => `${prefix}-new-${++i}`
}
const dimsOf = (job: Job) =>
  computeDimensions(job).parts.map((d) => ({ name: d.name, finished: d.finished, cutSize: d.cutSize, errors: d.errors.map((e) => e.kind) }))
const packOf = (job: Job) => {
  const r = packJob(job, computeDimensions(job))
  return {
    total: r.totalYieldRate,
    materials: r.materials.map((m) => ({ sheets: m.sheetCount, yield: m.yieldRate, stack: m.stack !== undefined, sizes: m.sheets.map((s) => s.placements.map((p) => p.sizeLabel)) })),
    done: r.done.length,
  }
}

/** 見本に、重ね切りの組の1枚（片1つ）と ラワン 4 の1枚（全部＝切り終わり）のチェックを付けたもの */
function checkedSample(): Job {
  let job = sampleFromTemplate(defaultTemplate(), NOW)
  const res = packJob(job, computeDimensions(job))
  const stack = res.materials.find((m) => m.stack)!
  const t1 = { kind: 'computed', boardId: stack.stack!.boardIds[0], stackWith: stack.stack!.boardIds[1], mode: stack.mode, layout: stack.sheets[0] } as const
  job = unwrap(setPieceCheck(job, t1, stack.sheets[0].placements[0].pieceId, true, NOW, 'sheet-a'))
  const lauan = res.materials.find((m) => !m.stack)!
  const t2 = { kind: 'computed', boardId: lauan.boardId, mode: lauan.mode, layout: lauan.sheets[0] } as const
  job = unwrap(setPieceCheck(job, t2, lauan.sheets[0].placements[0].pieceId, true, NOW, 'sheet-b'))
  expect(job.frozenSheets).toHaveLength(2)
  return job
}

describe('rekeyJob', () => {
  it('frozen: false：材料・フラッシュ・部材・逃げの id が全部新しく、寸法表・木取りは同じ。固定した1枚は無い', () => {
    const src = sampleFromTemplate(defaultTemplate(), NOW)
    const out = rekeyJob(src, { job: 'job-x', next: counter() }, { frozen: false })
    expect(out.id).toBe('job-x')
    expect(out.name).toBe(src.name)
    const oldIds = new Set([...src.boards.map((b) => b.id), ...src.flushes.map((f) => f.id), ...src.parts.map((p) => p.id), ...src.settings.nige.map((n) => n.id)])
    const newIds = [...out.boards.map((b) => b.id), ...out.flushes.map((f) => f.id), ...out.parts.map((p) => p.id), ...out.settings.nige.map((n) => n.id)]
    for (const id of newIds) expect(oldIds.has(id)).toBe(false)
    expect(new Set(newIds).size).toBe(newIds.length)
    const json = JSON.stringify(out)
    for (const id of oldIds) expect(json.includes(id)).toBe(false)
    expect(out.frozenSheets).toEqual([])
    expect(dimsOf(out)).toEqual(dimsOf(src))
    expect(packOf(out)).toEqual(packOf(src))
    expect(out.stackSheets[0].boardIds.every((id) => out.boards.some((b) => b.id === id))).toBe(true)
  })

  it('frozen: true：チェック数・「部材が変わっています」無し・frozenDemand の数が元と同じ。元の仕事は書き換わらない', () => {
    const src = checkedSample()
    const before = JSON.stringify(src)
    const out = rekeyJob(src, { job: 'job-y', next: counter() }, { frozen: true })
    expect(JSON.stringify(src)).toBe(before)
    const v0 = frozenSheetViews(src, computeDimensions(src))
    const v1 = frozenSheetViews(out, computeDimensions(out))
    // 進み具合は片の id の部材の部分だけ違う（部材の id を除けば同じ）
    const noPart = (x: unknown) => JSON.stringify(x).replace(/"part-[^"#]*#/g, '"#')
    expect(noPart(v1.map((v) => v.progress))).toBe(noPart(v0.map((v) => v.progress)))
    expect(v1.map((v) => v.sheet.checked.length)).toEqual([1, 1])
    expect(v1.map((v) => v.drift)).toEqual([[], []])
    expect(v1.map((v) => v.boardExists)).toEqual([true, true])
    expect(v1.map((v) => v.label)).toEqual(v0.map((v) => v.label))
    expect(v1.map((v) => v.complete)).toEqual(v0.map((v) => v.complete))
    expect([...frozenDemand(out).values()].sort()).toEqual([...frozenDemand(src).values()].sort())
    expect(frozenDemand(out).size).toBe(frozenDemand(src).size)
    // 固定した1枚の片は新しい部材を指す
    const partIds = new Set(out.parts.map((p) => p.id))
    for (const s of out.frozenSheets) {
      expect(out.boards.some((b) => b.id === s.boardId)).toBe(true)
      for (const p of s.layout.placements) {
        expect(partIds.has(p.partId)).toBe(true)
        expect(p.pieceId.startsWith(`${p.partId}#`)).toBe(true)
      }
      for (const c of s.checked) expect(s.layout.placements.some((p) => p.pieceId === c)).toBe(true)
    }
    // 木取り（固定した1枚を除いた残り）も同じ
    expect(packOf(out)).toEqual(packOf(src))
    // 写しを変えても元は変わらない
    out.frozenSheets[0].checked.push('x')
    out.frozenSheets[0].layout.placements[0].name = 'x'
    expect(JSON.stringify(src)).toBe(before)
  })

  it('削除された材料・部材を指す固定した1枚の id はそのまま残す', () => {
    const src = checkedSample()
    src.frozenSheets[1] = { ...src.frozenSheets[1], boardId: 'board-gone' }
    src.frozenSheets[1].layout = { ...src.frozenSheets[1].layout, placements: src.frozenSheets[1].layout.placements.map((p) => ({ ...p, partId: 'part-gone', pieceId: 'part-gone#0' })) }
    src.frozenSheets[1].checked = ['part-gone#0']
    const out = rekeyJob(src, { job: 'j', next: counter() }, { frozen: true })
    expect(out.frozenSheets[1].boardId).toBe('board-gone')
    expect(out.frozenSheets[1].layout.placements[0].pieceId).toBe('part-gone#0')
    expect(out.frozenSheets[1].checked).toEqual(['part-gone#0'])
  })

  it('cutByBoard のキーも新しい材料の id につけ替える', () => {
    const src = sampleFromTemplate(defaultTemplate(), NOW)
    const side = src.parts.find((p) => p.name === '側板')!
    const face = src.flushes[src.flushes.length - 1].faces[0].boardId
    side.checks = { ...side.checks, cutByBoard: { [face]: true } }
    const out = rekeyJob(src, { job: 'j', next: counter() }, { frozen: false })
    const i = src.boards.findIndex((b) => b.id === face)
    expect(out.parts.find((p) => p.name === '側板')!.checks.cutByBoard).toEqual({ [out.boards[i].id]: true })
  })
})

describe('copyJob（rekeyJob を使う）', () => {
  it('見本のコピーで逃げの id も新しくなり、寸法表・木取りの結果が同じ', () => {
    const src = sampleFromTemplate(defaultTemplate(), NOW)
    const copy = copyJob(src, [src.name], NOW, 'job-copy')
    expect(copy.name).toBe('本棚 W900 のコピー')
    expect(copy.frozenSheets).toEqual([])
    const old = new Set(src.settings.nige.map((n) => n.id))
    for (const n of copy.settings.nige) expect(old.has(n.id)).toBe(false)
    expect(copy.settings.nige.map((n) => [n.name, n.value])).toEqual(src.settings.nige.map((n) => [n.name, n.value]))
    expect(dimsOf(copy)).toEqual(dimsOf(src))
    expect(packOf(copy)).toEqual(packOf(src))
  })
})

describe('addJobs', () => {
  it('2つ足すと state の変更は1回で、open なら最後の1つを開く', () => {
    const s0 = initialState({ status: 'empty', data: { jobs: [], currentJobId: null } })
    const a = sampleFromTemplate(defaultTemplate(), NOW)
    const b = copyJob(a, [a.name], NOW)
    const s1 = storeReducer(s0, { type: 'addJobs', jobs: [a, b], open: true })
    expect(s1.jobs.map((j) => j.id)).toEqual([a.id, b.id])
    expect(s1.currentJobId).toBe(b.id)
    const s2 = storeReducer(s0, { type: 'addJobs', jobs: [a, b], open: false })
    expect(s2.currentJobId).toBe(null)
    expect(s2.template).toBe(s0.template)
  })

  it('空の一覧なら state はそのまま', () => {
    const s0 = initialState({ status: 'empty', data: { jobs: [], currentJobId: null } })
    expect(storeReducer(s0, { type: 'addJobs', jobs: [], open: true })).toBe(s0)
  })

  it('setTemplate でひな形を置き換える', () => {
    const s0 = initialState({ status: 'empty', data: { jobs: [], currentJobId: null } })
    const t = { ...defaultTemplate(), flushes: [] }
    t.settings.kerf = 4
    expect(storeReducer(s0, { type: 'setTemplate', template: t }).template.settings.kerf).toBe(4)
  })
})

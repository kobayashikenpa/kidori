// S-27：バックアップのファイル（buildBackup・backupFileName・importBackup。architecture.md 16.5）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../../engine/dimensions'
import { packJob } from '../../engine/packing'
import { frozenSheetViews } from '../../engine/progress/frozen'
import type { Job } from '../../engine/types'
import { setPieceCheck, type OpResult } from '../jobs'
import { initialState, storeReducer, type StoreState } from '../reducer'
import { sampleJob } from '../sample'
import { bigJob } from './fixtures/bigJob'
import { readTransferFile } from './read'
import { backupFileName, buildBackup, importBackup } from './backup'
import { buildShareFile } from './share'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const LATER = new Date('2026-10-01T08:00:00.000Z')
const unwrap = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const dimsOf = (job: Job) => computeDimensions(job).parts.map((d) => [d.name, d.finished, d.cutSize, d.errors.map((e) => e.kind)])
const packOf = (job: Job) => {
  const r = packJob(job, computeDimensions(job))
  return [r.totalYieldRate, r.materials.map((m) => [m.material, m.thickness, m.stack !== undefined, m.sheetCount, m.yieldRate])]
}
/** 固定した1枚の見え方（部材の id を除く） */
const frozenOf = (job: Job) =>
  JSON.stringify(
    frozenSheetViews(job, computeDimensions(job)).map((v) => ({
      label: v.label,
      exists: v.boardExists,
      progress: v.progress,
      drift: v.drift.map((d) => [d.name, d.reason]),
      complete: v.complete,
      checked: v.sheet.checked.length,
      frozenAt: v.sheet.frozenAt,
    })),
  ).replace(/"part-[^"#]*#/g, '"#')

/** 見本：重ね切りの組の1枚にチェック（片1つ）と、ラワン 4 の1枚（片1つ＝切り終わり） */
function checkedSample(): Job {
  let job = sampleJob(NOW)
  const res = packJob(job, computeDimensions(job))
  const st = res.materials.find((m) => m.stack)!
  const t1 = { kind: 'computed', boardId: st.stack!.boardIds[0], stackWith: st.stack!.boardIds[1], mode: st.mode, layout: st.sheets[0] } as const
  job = unwrap(setPieceCheck(job, t1, st.sheets[0].placements[0].pieceId, true, NOW, 'sheet-a'))
  const la = res.materials.find((m) => !m.stack)!
  const t2 = { kind: 'computed', boardId: la.boardId, mode: la.mode, layout: la.sheets[0] } as const
  job = unwrap(setPieceCheck(job, t2, la.sheets[0].placements[0].pieceId, true, NOW, 'sheet-b'))
  expect(job.frozenSheets.map((f) => f.completedAt !== undefined)).toEqual([false, true])
  return job
}

function stateOf(jobs: Job[]): StoreState {
  return initialState({ status: 'ok', data: { jobs, currentJobId: jobs[0]?.id ?? null } })
}

/** 読み込んで、reducer に当てる（UI と同じ流れ） */
function apply(state: StoreState, text: string): { state: StoreState; message: string } {
  const r = readTransferFile(text)
  if (!r.ok || r.kind !== 'backup') throw new Error('バックアップとして読めない')
  const imp = importBackup(state, r, LATER)
  let s = storeReducer(state, { type: 'addJobs', jobs: imp.jobs, open: false })
  return { state: s, message: imp.message }
}

describe('buildBackup', () => {
  it('外側は kind: backup・version 1・dataVersion 3。仕事はそのまま、ひな形は入れない（第2.5.1版）', () => {
    const a = checkedSample()
    const data = JSON.parse(buildBackup(stateOf([a]), NOW))
    expect([data.app, data.kind, data.version, data.dataVersion, data.exportedAt]).toEqual(['kidori', 'backup', 1, 3, NOW.toISOString()])
    expect(data.jobs).toEqual([a])
    expect('template' in data).toBe(false)
  })

  it('仕事が0件でも書き出せる（空の一覧）。ただし読むと「読み込めませんでした」', () => {
    const text = buildBackup(stateOf([]), NOW)
    expect(JSON.parse(text).jobs).toEqual([])
    expect(readTransferFile(text).ok).toBe(false)
  })
})

describe('backupFileName', () => {
  it('kidori-バックアップ-2026-09-28.json（端末の日付）', () => {
    expect(backupFileName(new Date(2026, 8, 28, 23, 59))).toBe('kidori-バックアップ-2026-09-28.json')
    expect(backupFileName(new Date(2026, 0, 5, 0, 0))).toBe('kidori-バックアップ-2026-01-05.json')
  })
})

describe('バックアップの行って戻る（buildBackup → readTransferFile → importBackup）', () => {
  it('空の state に読み込むと、2件の寸法表・木取り・固定した1枚が元と同じ。日付はファイルのまま', () => {
    const a = checkedSample()
    const b = bigJob(50, NOW)
    const text = buildBackup(stateOf([a, b]), NOW)
    const empty = stateOf([])
    const { state, message } = apply(empty, text)
    expect(message).toBe('2件の仕事を追加しました')
    expect(state.jobs).toHaveLength(2)
    const [x, y] = state.jobs
    expect([x.name, y.name]).toEqual([a.name, b.name])
    expect([x.createdAt, x.updatedAt]).toEqual([a.createdAt, a.updatedAt])
    expect(x.id).not.toBe(a.id)
    expect(dimsOf(x)).toEqual(dimsOf(a))
    expect(dimsOf(y)).toEqual(dimsOf(b))
    expect(packOf(x)).toEqual(packOf(a))
    expect(packOf(y)).toEqual(packOf(b))
    expect(frozenOf(x)).toBe(frozenOf(a))
    expect(x.frozenSheets).toHaveLength(2)
    expect(state.currentJobId).toBe(null)
  })

  it('仕事のある state に同じファイルを2回読むと「のコピー」「のコピー 2」で4件増え、開いている仕事・今の仕事は変わらない', () => {
    const a = checkedSample()
    const b = bigJob(50, NOW)
    const text = buildBackup(stateOf([a, b]), NOW)
    const s0 = stateOf([a, b])
    const before = JSON.stringify(s0.jobs)
    const s1 = apply(s0, text).state
    const s2 = apply(s1, text).state
    expect(s2.jobs.map((j) => j.name)).toEqual([
      '本棚 W900',
      '部材50の仕事',
      '本棚 W900 のコピー',
      '部材50の仕事 のコピー',
      '本棚 W900 のコピー 2',
      '部材50の仕事 のコピー 2',
    ])
    expect(new Set(s2.jobs.map((j) => j.id)).size).toBe(6)
    expect(s2.currentJobId).toBe(s0.currentJobId)
    expect(JSON.stringify(s2.jobs.slice(0, 2))).toBe(before)
    expect(frozenOf(s2.jobs[4])).toBe(frozenOf(a))
  })

  it('足す仕事どうしで名前が重なっても重ならないようにする', () => {
    const a = sampleJob(NOW)
    const b = sampleJob(NOW)
    const { state } = apply(stateOf([]), buildBackup(stateOf([a, b]), NOW))
    expect(state.jobs.map((j) => j.name)).toEqual(['本棚 W900', '本棚 W900 のコピー'])
  })

  it('以前のファイルのひな形（最後に使った設定）は読み飛ばし、仕事だけ足す', () => {
    const a = sampleJob(NOW)
    const text = JSON.stringify({ ...JSON.parse(buildBackup(stateOf([a]), NOW)), template: { settings: { kerf: 2 } } })
    const { state } = apply(stateOf([]), text)
    expect(state.jobs).toHaveLength(1)
    expect('template' in state).toBe(false)
  })

  it('共有のファイルは kind: share になり、バックアップとしては足されない', () => {
    const r = readTransferFile(buildShareFile(sampleJob(NOW), NOW))
    expect(r.ok && r.kind).toBe('share')
    expect(() => apply(stateOf([]), buildShareFile(sampleJob(NOW), NOW))).toThrow()
  })

  it('部材 150 の仕事を含むバックアップも数秒以内に読み込める', () => {
    const t0 = performance.now()
    const src = [bigJob(150, NOW), checkedSample()]
    const { state } = apply(stateOf([]), buildBackup(stateOf(src), NOW))
    expect(state.jobs[0].parts).toHaveLength(150)
    expect(dimsOf(state.jobs[0])).toEqual(dimsOf(src[0]))
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

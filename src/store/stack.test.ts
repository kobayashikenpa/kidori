import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { LAUAN_25_ID, LAUAN_4_ID, MELAMINE_1_ID, SAMPLE_FLUSH_ID, sampleFlushJob } from '../engine/fixtures/flush'
import { packJob } from '../engine/packing'
import { stackKey, stackPlan } from '../engine/packing/stack'
import type { Job } from '../engine/types'
import {
  addFlush,
  copyJob,
  createJob,
  removeBoards,
  setBoardSize,
  setBoardsSize,
  setPieceCheck,
  updateFlush,
  type OpResult,
} from './jobs'
import { sampleFromTemplate } from './sample'
import { JOBS_KEY, loadSaved, sanitizeJobs, saveSaved, type KeyValueStorage } from './storage'
import { defaultTemplate, sameTemplate, templateOf } from './template'

const NOW = new Date('2026-09-27T09:00:00.000Z')
const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const SHIHACHI = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const
const unwrap = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const pack = (job: Job) => packJob(job, computeDimensions(job))
function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}
const MSG = '重ねて切れるのは、表面材が2種類で枚数が同じときだけです'

describe('フラッシュの重ね切りの設定（validateFlush・cleanFlush）', () => {
  it('表面材 メラミン1×2・ラワン4×1 で stack: true は断られる（足す・変える）', () => {
    const job = sampleFlushJob(false)
    const faces = [{ boardId: MELAMINE_1_ID, count: 2 }, { boardId: LAUAN_4_ID, count: 1 }]
    expect(addFlush(job, { name: 'フラッシュ22', core: 15, faces, stack: true })).toEqual({ ok: false, message: MSG })
    const f = job.flushes[0]
    expect(updateFlush(job, f.id, { name: f.name, core: f.core, faces, stack: true })).toEqual({ ok: false, message: MSG })
  })

  it('条件に合えば stack: true を持ち、オフ（false・無し）は持たない', () => {
    const job = sampleFlushJob(false)
    const f = job.flushes[0]
    const on = unwrap(updateFlush(job, f.id, { name: f.name, core: f.core, faces: f.faces, stack: true }))
    expect(on.flushes[0].stack).toBe(true)
    const off = unwrap(updateFlush(on, f.id, { name: f.name, core: f.core, faces: f.faces, stack: false as unknown as true }))
    expect('stack' in off.flushes[0]).toBe(false)
    const added = unwrap(addFlush(job, { name: 'フラッシュ21', core: 11, faces: f.faces, stack: true }, 'f2'))
    expect(added.flushes[1]).toEqual({ id: 'f2', name: 'フラッシュ21', core: 11, faces: f.faces, stack: true })
  })

  it('ラワン 4 を削除すると フラッシュ25 の stack が外れる。ほかの材料を消しても外れない', () => {
    const job = sampleFlushJob(true)
    expect('stack' in unwrap(removeBoards(job, [LAUAN_4_ID])).flushes[0]).toBe(false)
    expect(unwrap(removeBoards(job, [LAUAN_25_ID])).flushes[0].stack).toBe(true)
  })
})

describe('読み込み（sanitizeFlushes・固定した1枚の stackWith）', () => {
  const raw = (edit: (j: any) => void) => {
    const j = JSON.parse(JSON.stringify(sampleFlushJob(true)))
    edit(j)
    return sanitizeJobs([j])
  }

  it('正しい stack はそのまま（直した数 0）', () => {
    const r = raw(() => {})
    expect(r.fixes).toBe(0)
    expect(r.jobs[0].flushes[0].stack).toBe(true)
  })

  it("stack: 'yes' や条件に合わない stack は外れて直した数 1", () => {
    const a = raw((j) => (j.flushes[0].stack = 'yes'))
    expect([a.fixes, 'stack' in a.jobs[0].flushes[0]]).toEqual([1, false])
    const b = raw((j) => (j.flushes[0].faces[1].count = 1))
    expect([b.fixes, 'stack' in b.jobs[0].flushes[0]]).toEqual([1, false])
    const c = raw((j) => (j.flushes[0].stack = false))
    expect([c.fixes, 'stack' in c.jobs[0].flushes[0]]).toEqual([1, false])
  })

  function withFrozen(edit: (s: any) => void) {
    let job = sampleFlushJob(true)
    const m = pack(job).materials[0]
    const t = { kind: 'computed', boardId: MELAMINE_1_ID, stackWith: LAUAN_4_ID, mode: m.mode, layout: m.sheets[0] } as const
    job = unwrap(setPieceCheck(job, t, m.sheets[0].placements[0].pieceId, true, NOW, 'sheet-1'))
    const j = JSON.parse(JSON.stringify(job))
    edit(j.frozenSheets[0])
    return sanitizeJobs([j])
  }

  it('正しい stackWith はそのまま。材料名・厚みが読めなければ直して数える', () => {
    const ok = withFrozen(() => {})
    expect(ok.fixes).toBe(0)
    expect(ok.jobs[0].frozenSheets[0].stackWith).toEqual({ boardId: LAUAN_4_ID, material: 'ラワン', thickness: 4 })
    const fixed = withFrozen((s) => {
      s.stackWith.material = 3
      s.stackWith.thickness = -1
    })
    expect(fixed.fixes).toBe(2)
    expect(fixed.jobs[0].frozenSheets[0].stackWith).toEqual({ boardId: LAUAN_4_ID, material: '', thickness: 1 })
  })

  it('stackWith.boardId が無い・自分と同じ・stackWith が読めない固定した1枚は外れる（直した数 1）', () => {
    for (const edit of [
      (s: any) => delete s.stackWith.boardId,
      (s: any) => (s.stackWith.boardId = MELAMINE_1_ID),
      (s: any) => (s.stackWith = 'ラワン'),
    ]) {
      const r = withFrozen(edit)
      expect(r.fixes).toBe(1)
      expect(r.jobs[0].frozenSheets).toEqual([])
    }
  })
})

describe('保存・引き継ぎ・コピー', () => {
  it('保存して読み込むと stack と stackWith が残る', () => {
    let job = sampleFlushJob(true)
    const m = pack(job).materials[0]
    const t = { kind: 'computed', boardId: MELAMINE_1_ID, stackWith: LAUAN_4_ID, mode: m.mode, layout: m.sheets[0] } as const
    job = unwrap(setPieceCheck(job, t, m.sheets[0].placements[0].pieceId, true, NOW, 'sheet-1'))
    const s = memoryStorage()
    expect(saveSaved(s, { jobs: [job], currentJobId: job.id })).toEqual({ ok: true })
    expect(s.getItem(JOBS_KEY)).toContain('"stack":true')
    const r = loadSaved(s, NOW)
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual(job)
  })

  it('ひな形から新しい仕事を作ると stack が残る（材料が見つからず条件から外れると外す）', () => {
    const tpl = templateOf(sampleFlushJob(true))
    expect(tpl.flushes[0].stack).toBe(true)
    expect(sameTemplate(tpl, templateOf(sampleFlushJob(false)))).toBe(false)
    const job = createJob('新しい仕事', tpl, NOW)
    expect(job.flushes[0].stack).toBe(true)
    expect(stackPlan(job).groups).toHaveLength(1)
    const missing = { ...tpl, materials: tpl.materials.filter((m) => m.thickness !== 4) }
    expect('stack' in createJob('x', missing, NOW).flushes[0]).toBe(false)
    // 見本：ひな形のフラッシュ25 を使うので stack も残る。重ね切りの見本の値になる
    const sample = sampleFromTemplate(tpl, NOW)
    expect(sample.flushes[0].stack).toBe(true)
    expect(pack(sample).materials.map((x) => x.sheetCount)).toEqual([5, 1])
    // 初期のひな形の見本は、見本がフラッシュ25 を足すので重ね切りオン（第2.1版）
    expect(sampleFromTemplate(defaultTemplate(), NOW).flushes[0].stack).toBe(true)
  })

  it('仕事をコピーすると stack が残る（表面材は新しい材料を指す）', () => {
    const copy = copyJob(sampleFlushJob(true), [], NOW, 'job-copy')
    expect(copy.flushes[0].stack).toBe(true)
    expect(stackPlan(copy).groups[0].boardIds).toEqual([copy.boards[0].id, copy.boards[2].id])
  })
})

describe('組のチェック・サイズ', () => {
  it('組の計算した1枚目の側板にチェックすると frozenSheets の1枚に stackWith（ラワン 4）が付き、組が4枚に', () => {
    const job = sampleFlushJob(true)
    const m = pack(job).materials[0]
    expect(m.boardId).toBe(KEY)
    const layout = m.sheets[0]
    const t = { kind: 'computed', boardId: m.stack!.boardIds[0], stackWith: m.stack!.boardIds[1], mode: m.mode, layout } as const
    const next = unwrap(setPieceCheck(job, t, layout.placements[0].pieceId, true, NOW, 'sheet-1'))
    expect(next.frozenSheets).toHaveLength(1)
    expect(next.frozenSheets[0]).toMatchObject({
      boardId: MELAMINE_1_ID,
      stackWith: { boardId: LAUAN_4_ID, material: 'ラワン', thickness: 4 },
      checked: [layout.placements[0].pieceId],
    })
    expect(pack(next).materials.map((x) => [x.boardId, x.sheetCount])).toEqual([[KEY, 4], [LAUAN_4_ID, 1]])
    // 2つとも外すと固定が外れ、組は5枚に戻る
    const back = unwrap(setPieceCheck(next, { kind: 'frozen', sheetId: 'sheet-1' }, layout.placements[0].pieceId, false, NOW))
    expect(pack(back).materials.map((x) => x.sheetCount)).toEqual([5, 1])
  })

  it('stackWith の材料が無い・自分と同じなら断る', () => {
    const job = sampleFlushJob(true)
    const m = pack(job).materials[0]
    const p = m.sheets[0].placements[0].pieceId
    for (const stackWith of ['board-none', MELAMINE_1_ID]) {
      const t = { kind: 'computed', boardId: MELAMINE_1_ID, stackWith, mode: m.mode, layout: m.sheets[0] } as const
      expect(setPieceCheck(job, t, p, true, NOW).ok).toBe(false)
    }
  })

  it('setBoardsSize でメラミン 1 とラワン 4 を 4×8 にすると両方が 4×8 で組がそろう', () => {
    const job = unwrap(setBoardsSize(sampleFlushJob(true), [MELAMINE_1_ID, LAUAN_4_ID], SHIHACHI))
    for (const id of [MELAMINE_1_ID, LAUAN_4_ID]) expect(job.boards.find((b) => b.id === id)).toMatchObject(SHIHACHI)
    expect(job.boards.find((b) => b.id === LAUAN_25_ID)?.sizeKind).toBe('saburoku')
    expect(stackPlan(job)).toMatchObject({ groups: [{ key: KEY }], mismatches: [] })
    expect(setBoardsSize(job, [], SHIHACHI).ok).toBe(false)
    expect(setBoardsSize(job, ['board-none'], SHIHACHI).ok).toBe(false)
  })

  it('重ね切りの組の材料で setBoardSize を選ぶと、相手の材料も同じサイズになる（未決事項 36）', () => {
    const job = unwrap(setBoardSize(sampleFlushJob(true), LAUAN_4_ID, SHIHACHI))
    for (const id of [MELAMINE_1_ID, LAUAN_4_ID]) expect(job.boards.find((b) => b.id === id)).toMatchObject(SHIHACHI)
    expect(stackPlan(job).mismatches).toEqual([])
    // 重ね切りがオフなら、その材料だけ
    const off = unwrap(setBoardSize(sampleFlushJob(false), LAUAN_4_ID, SHIHACHI))
    expect(off.boards.find((b) => b.id === MELAMINE_1_ID)?.sizeKind).toBe('saburoku')
  })

  it('そろっていない組（ラワン 4 だけ 4×8）でも、材料の行で 3×6 に戻すと相手もそろう', () => {
    const job = sampleFlushJob(true)
    job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, ...SHIHACHI } : b))
    expect(stackPlan(job).mismatches).toHaveLength(1)
    const back = unwrap(setBoardSize(job, MELAMINE_1_ID, { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' }))
    expect(stackPlan(back).groups).toHaveLength(1)
    expect(back.flushes[0].id).toBe(SAMPLE_FLUSH_ID)
  })
})

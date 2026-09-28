import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { flushJob, LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../fixtures/flush'
import { findSavingHints } from '../hints/saving'
import { packJob } from '../packing'
import { compareStandardSizes } from '../packing/sizes'
import { stackKey } from '../packing/stack'
import type { Job } from '../types'
import { freezeSheet, frozenSheetViews, materialSummaries } from './frozen'

const NOW = new Date('2026-09-27T09:00:00.000Z')
const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const pct = (r: number) => Math.round(r * 1000) / 10

function summaries(job: Job) {
  const dims = computeDimensions(job)
  const result = packJob(job, dims)
  return materialSummaries(job, result, frozenSheetViews(job, dims))
}
const rows = (job: Job) =>
  summaries(job).materials.map((m) => [m.boardId, m.sheetCount, m.stackedCount, m.completedCount])

/** 組の i 枚目を固定する（checks 個にチェック。全部なら切り終わり） */
function freezeStack(job: Job, i: number, checks = 1): Job {
  const m = packJob(job, computeDimensions(job)).materials.find((x) => x.boardId === KEY)!
  const f = freezeSheet(job, MELAMINE_1_ID, m.mode, m.sheets[i], `sheet-${job.frozenSheets.length + 1}`, NOW, LAUAN_4_ID)
  f.checked = f.layout.placements.slice(0, checks).map((p) => p.pieceId)
  if (f.checked.length === f.layout.placements.length) f.completedAt = NOW.toISOString()
  return { ...job, frozenSheets: [...job.frozenSheets, f] }
}

describe('固定した組の1枚・まとめ（E-52）', () => {
  it('重ね切りオンの見本（第2.1版）：組 5枚・ラワン 4 は背板の 1枚だけ・メラミン 1 の行は無い・全体 86.4%（変わらない）', () => {
    const s = summaries(sampleFlushJob(true))
    expect(s.materials.map((m) => [m.boardId, m.sheetCount, m.stackedCount, m.completedCount])).toEqual([
      [KEY, 5, 5, 0],
      [LAUAN_4_ID, 1, 0, 0],
    ])
    expect(s.materials[0].stack).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID] })
    expect(s.materials[1].stack).toBeUndefined()
    expect(s.materials.map((m) => pct(m.yieldRate))).toEqual([85.2, 97.8])
    expect(pct(s.totalYieldRate)).toBe(86.4)
  })

  it('重ね切りオフなら組の行は無く、うち重ね切りは 0', () => {
    expect(rows(sampleFlushJob(false))).toEqual([
      [MELAMINE_1_ID, 5, 0, 0],
      [LAUAN_4_ID, 6, 0, 0],
    ])
  })

  it('freezeSheet の stackWith に もう1つの材料の名前・厚みを写す', () => {
    const job = freezeStack(sampleFlushJob(true), 0)
    const f = job.frozenSheets[0]
    expect(f.boardId).toBe(MELAMINE_1_ID)
    expect(f.stackWith).toEqual({ boardId: LAUAN_4_ID, material: 'ラワン', thickness: 4 })
    expect(freezeSheet(job, MELAMINE_1_ID, 'vertical', f.layout, 'x', NOW).stackWith).toBeUndefined()
    expect(() => freezeSheet(job, MELAMINE_1_ID, 'vertical', f.layout, 'x', NOW, 'board-none')).toThrow()
  })

  it('組の1枚目を切り終わりにすると 組は 4枚で切り終わり 1・ラワン 4 は 1枚のまま（メラミン 1 の行は無い）', () => {
    const job = freezeStack(sampleFlushJob(true), 0, 2)
    expect(rows(job)).toEqual([
      [KEY, 4, 4, 1],
      [LAUAN_4_ID, 1, 0, 0],
    ])
    const [v] = frozenSheetViews(job, computeDimensions(job))
    expect(v.label).toBe('メラミン1＋ラワン4（重ね切り）')
    expect(v.complete).toBe(true)
    expect(v.drift).toEqual([])

    // その後に重ね切りをオフにしても固定した組の1枚は残り、メラミン 1 のふつうの結果は4枚
    const off: Job = { ...job, flushes: job.flushes.map(({ stack: _s, ...f }) => f) }
    const r = packJob(off, computeDimensions(off))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount])).toEqual([[MELAMINE_1_ID, 4], [LAUAN_4_ID, 5]])
    expect(off.frozenSheets).toHaveLength(1)
    expect(rows(off)).toEqual([
      [MELAMINE_1_ID, 4, 0, 0],
      [KEY, 0, 0, 1],
      [LAUAN_4_ID, 5, 0, 0],
    ])
  })

  it('固定中（切り終わり前）の組の1枚は組の行だけに数える。全体の歩留まりは両方の材料に数えたまま', () => {
    const job = freezeStack(sampleFlushJob(true), 0, 1)
    expect(rows(job)).toEqual([
      [KEY, 5, 5, 0],
      [LAUAN_4_ID, 1, 0, 0],
    ])
    expect(pct(summaries(job).totalYieldRate)).toBe(86.4)
  })

  it('全体の歩留まり：組の1枚は a・b の2枚として数える（行の枚数の合計とは別）', () => {
    // 組 5枚 ×2（メラミン 1・ラワン 4）＋ 背板の1枚。組の片の面積も2回数える
    const job = sampleFlushJob(true)
    const off = sampleFlushJob(false)
    expect(summaries(job).totalYieldRate).toBeCloseTo(summaries(off).totalYieldRate, 10)
  })

  it('側板の枚数を 0 にすると drift に 側板（count）', () => {
    const job = freezeStack(sampleFlushJob(true), 0, 1)
    const changed: Job = { ...job, parts: job.parts.map((p) => (p.name === '側板' ? { ...p, quantity: 0 } : p)) }
    expect(frozenSheetViews(changed, computeDimensions(changed))[0].drift).toEqual([
      { partId: 'part-gawa', name: '側板', reason: 'count' },
    ])
  })

  it('ラワン 4 を表面材から外すと drift に 側板（removed）。材料を消すと写しの名前で表示', () => {
    const job = freezeStack(sampleFlushJob(true), 0, 1)
    const changed: Job = {
      ...job,
      flushes: job.flushes.map((f) => ({ ...f, faces: f.faces.filter((x) => x.boardId !== LAUAN_4_ID) })),
    }
    expect(frozenSheetViews(changed, computeDimensions(changed))[0].drift.map((d) => d.reason)).toEqual(['removed'])
    const gone: Job = { ...job, boards: job.boards.filter((b) => b.id !== LAUAN_4_ID) }
    const v = frozenSheetViews(gone, computeDimensions(gone))[0]
    expect(v.label).toBe('メラミン1＋ラワン4（重ね切り）')
    expect(v.boardExists).toBe(false)
  })

  it('重ね切りのオン・オフ、サイズがそろっていないことは drift にしない', () => {
    const job = freezeStack(sampleFlushJob(true), 0, 1)
    const off: Job = { ...job, flushes: job.flushes.map(({ stack: _s, ...f }) => f) }
    expect(frozenSheetViews(off, computeDimensions(off))[0].drift).toEqual([])
    const big: Job = {
      ...job,
      boards: job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b)),
    }
    expect(frozenSheetViews(big, computeDimensions(big))[0].drift).toEqual([])
  })
})

describe('サイズの比較・お知らせ（E-52）', () => {
  it('オンのままの比較には組（stackKey）の 3×6 が 5枚。材料ごとの比較はふつうの片がある ラワン 4 だけ', () => {
    const job = sampleFlushJob(true)
    const c = compareStandardSizes(job, computeDimensions(job))
    expect(c.map((x) => x.boardId)).toEqual([KEY, LAUAN_4_ID])
    expect(c[0].options[0].sheetCount).toBe(5)
    expect(c[0].stack).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID] })
    expect(c[1].options[0].sheetCount).toBe(1)
  })

  it('ラワン 4 を 4×8 にしていても、比較に組の行が出る（第2.3版。組は組の設定で重ねたまま）', () => {
    const job = sampleFlushJob(true)
    job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
    const c = compareStandardSizes(job, computeDimensions(job))
    expect(c.map((x) => x.boardId)).toEqual([KEY, LAUAN_4_ID])
    expect(c[0].stack).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID] })
  })

  it('お知らせの組の表示名は「メラミン1＋ラワン4（重ね切り）」（天板 910×610 が 1820 に2枚入る切り代 8mm で 4枚 → 2枚）', () => {
    const job = flushJob()
    job.flushes[0].stack = true
    // 組の設定は 3×6（第2.3版。無ければ 4×8 で並ぶ）
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' }]
    expect(findSavingHints(job).map((h) => h.message)).toEqual([
      '切り代を 8mm にすると、メラミン1＋ラワン4（重ね切り） が 2 枚減ります（4枚 → 2枚）',
    ])
  })
})

// E-62：比較・手持ちの残り・足りないときの知らせに重ね切りの組の行を入れる（第2.3版。architecture.md 15.5）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../fixtures/flush'
import { withStackStock, withStock } from '../fixtures/stock'
import { findSavingHints } from '../hints/saving'
import { stockShortage } from '../hints/shortage'
import { packJob } from '../packing'
import { compareStandardSizes } from '../packing/sizes'
import { stackKey } from '../packing/stack'
import type { Job } from '../types'
import { freezeSheet, frozenSheetViews, materialSizeCounts, stockUsage } from './frozen'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const

function lauanTo48(job: Job): Job {
  job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
  return job
}
const usage = (job: Job) => stockUsage(job, packJob(job, computeDimensions(job)))
const shortage = (job: Job) => stockShortage(job, computeDimensions(job))

describe('compareStandardSizes と組の行', () => {
  it('見本でラワン 4 を 4×8 にしていても、比較の組の 3×6 が 5枚、ラワン 4 の 3×6 が 1枚', () => {
    const job = lauanTo48(sampleFlushJob(true))
    const c = compareStandardSizes(job, computeDimensions(job))
    expect(c.map((x) => [x.boardId, x.options[0].sheetCount])).toEqual([
      [KEY, 5],
      [LAUAN_4_ID, 1],
    ])
    expect(c[0].stack).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID] })
  })

  it('組の設定が 3×6 でも、比較の 4×8 は 4×8 で並べた枚数（3×6 と違う値）', () => {
    const job = sampleFlushJob(true)
    const c = compareStandardSizes(job, computeDimensions(job))
    const g = c.find((x) => x.boardId === KEY)!
    // 4×8 の比較は、組の設定を 4×8 にした仕事の組の枚数と同じ
    const as48 = { ...job, stackSheets: [{ ...job.stackSheets[0], sizeKind: 'shihachi' as const, width: 1220, length: 2440 }] }
    const real48 = packJob(as48, computeDimensions(as48)).materials.find((m) => m.boardId === KEY)!.sheetCount
    expect(g.options.map((o) => o.sheetCount)).toEqual([5, real48])
    // 元の仕事は変えない
    expect(job.stackSheets[0].sizeKind).toBe('saburoku')
  })

  it('手持ちの組も 3×6・4×8 にして比べる（手持ち 3×6 ×3 でも、手持ちなしと同じ枚数・入らない 0）', () => {
    const job = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 3]])
    const g = compareStandardSizes(job, computeDimensions(job)).find((x) => x.boardId === KEY)!
    const plain = sampleFlushJob(true)
    const p = compareStandardSizes(plain, computeDimensions(plain)).find((x) => x.boardId === KEY)!
    expect(g.options.map((o) => [o.sheetCount, o.unplacedCount])).toEqual(p.options.map((o) => [o.sheetCount, 0]))
    expect(g.options[0].sheetCount).toBe(5)
  })
})

describe('stockUsage と組の行', () => {
  it('組の手持ち 3×6 ×6 → 組 使う5・残り1、ラワン 4 の手持ち 3×6 ×1 → 使う1・残り0（組の1枚を数えない）', () => {
    const job = withStock(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 6]]), LAUAN_4_ID, [['3×6', 1]])
    expect(usage(job)).toEqual([
      { boardId: KEY, stack: { boardIds: [MELAMINE_1_ID, LAUAN_4_ID] }, rows: [{ stockId: 's1', label: '3×6', count: 6, used: 5, left: 1 }] },
      { boardId: LAUAN_4_ID, rows: [{ stockId: 's1', label: '3×6', count: 1, used: 1, left: 0 }] },
    ])
  })

  it('組の行の a・b を逆に保存していても、組の id は材料の保存の並び', () => {
    const job = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 6]])
    job.stackSheets[0].boardIds = [LAUAN_4_ID, MELAMINE_1_ID]
    expect(usage(job).map((u) => [u.boardId, u.stack])).toEqual([[KEY, { boardIds: [MELAMINE_1_ID, LAUAN_4_ID] }]])
  })

  it('組の固定した1枚（切り終わりを含む）は組の行で数え、材料の行では数えない', () => {
    const job = withStock(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 6]]), MELAMINE_1_ID, [['3×6', 2]])
    const g = packJob(job, computeDimensions(job)).materials.find((m) => m.boardId === KEY)!
    const f = freezeSheet(job, MELAMINE_1_ID, g.mode, g.sheets[0], 'f', new Date('2026-09-28T00:00:00Z'), LAUAN_4_ID)
    f.checked = g.sheets[0].placements.map((p) => p.pieceId)
    f.completedAt = '2026-09-28T00:00:00.000Z'
    job.frozenSheets = [f]
    expect(usage(job)).toEqual([
      { boardId: MELAMINE_1_ID, rows: [{ stockId: 's1', label: '3×6', count: 2, used: 0, left: 2 }] },
      { boardId: KEY, stack: { boardIds: [MELAMINE_1_ID, LAUAN_4_ID] }, rows: [{ stockId: 's1', label: '3×6', count: 6, used: 5, left: 1 }] },
    ])
  })
})

describe('materialSizeCounts と組の行', () => {
  it('組の行は組の1枚（3×6 ×5）、ラワン 4 の行はふつうの1枚（4×8 ×1）だけ', () => {
    const job = lauanTo48(sampleFlushJob(true))
    const dims = computeDimensions(job)
    const r = packJob(job, dims)
    expect(materialSizeCounts(job, r, frozenSheetViews(job, dims))).toEqual([
      { boardId: KEY, bySize: [{ label: '3×6', count: 5 }] },
      { boardId: LAUAN_4_ID, bySize: [{ label: '4×8', count: 1 }] },
    ])
  })
})

describe('stockShortage・findSavingHints と組の行', () => {
  it('組の手持ち 3×6 ×3 → 「メラミン1＋ラワン4（重ね切り）が足りません（入らない部材：棚板）」で 3×6 は 2枚', () => {
    const job = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 3]])
    const list = shortage(job)
    expect(list).toHaveLength(1)
    const [s] = list
    expect(s.boardId).toBe(KEY)
    expect(s.stack).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID] })
    expect(s.label).toBe('メラミン1＋ラワン4（重ね切り）')
    expect(s.missing).toEqual(['棚板'])
    expect(s.message).toBe('メラミン1＋ラワン4（重ね切り）が足りません（入らない部材：棚板）')
    expect(s.add[0]).toEqual({ kind: 'saburoku', count: 2 })
    expect(s.add[1].count).toBeGreaterThanOrEqual(1)
    // 足すと入る（組の行に足した写し）
    const added = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 5]])
    expect(shortage(added)).toEqual([])
  })

  it('お知らせ（減らせる）に手持ちが足りない組は出ない', () => {
    const job = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 3]])
    expect(findSavingHints(job).flatMap((h) => h.materials.map((m) => m.boardId))).not.toContain(KEY)
  })

  it('材料（ラワン 4）の手持ちが足りなくても、組は減らせるお知らせの対象のまま（組の手持ちは別）', () => {
    // 端切りを小さくして組が減るかは仕事によるので、対象から外していないこと（除外の集合）だけを見る：
    // ラワン 4 の手持ちが足りない仕事と足りない仕事でない仕事で、組についてのお知らせが同じ
    const base = sampleFlushJob(true)
    const shortLauan = withStock(sampleFlushJob(true), LAUAN_4_ID, [{ width: 600, length: 1200, grain: 'long', count: 1 }])
    const keyHints = (job: Job) => findSavingHints(job).filter((h) => h.materials.some((m) => m.boardId === KEY)).map((h) => h.message)
    expect(keyHints(shortLauan)).toEqual(keyHints(base))
  })

  it('足りない行が無ければ []（組の手持ちが足りているとき）', () => {
    expect(shortage(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 6]]))).toEqual([])
    expect(shortage(sampleFlushJob(true))).toEqual([])
  })

  it('組とラワン 4 の両方が足りないと、並びは 組 → ラワン 4（まとめの並び）', () => {
    const job = withStock(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 3]]), LAUAN_4_ID, [{ width: 600, length: 1200, grain: 'long', count: 1 }])
    expect(shortage(job).map((s) => [s.boardId, s.missing])).toEqual([
      [KEY, ['棚板']],
      [LAUAN_4_ID, ['背板']],
    ])
  })
})

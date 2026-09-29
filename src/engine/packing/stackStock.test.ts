// E-58 → E-61 → 第2.3版の追補で書き直し（E-64。architecture.md 15.9）：重ね切りの組は 3×6／4×8 だけ。
// 組の行に手持ち・自由入力が残っていても木取りは見ない。組は選んだサイズで足りるだけ使い、組の noStock は出ない。
// 材料の手持ちは、その材料をふつうに木取りする片だけに使う（組の分を引かない）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { stockRows, withStock, type StockRowDraft } from '../fixtures/stock'
import { stockShortage } from '../hints/shortage'
import { stockUsage } from '../progress/frozen'
import type { Job, MaterialResult } from '../types'
import { packJob } from './index'
import { stackKey, stackPlan } from './stack'
import { availableStackStock, stackChoice } from './stock'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const
const run = (job: Job) => packJob(job, computeDimensions(job))
const find = (ms: MaterialResult[], id: string) => ms.find((m) => m.boardId === id)

function sample(melamine: StockRowDraft[] | null, lauan: StockRowDraft[] | null): Job {
  const job = sampleGroupJob(true)
  if (melamine) withStock(job, MELAMINE_1_ID, melamine)
  if (lauan) withStock(job, LAUAN_4_ID, lauan)
  return job
}

/** 組の行に（以前の版の画面で入れた）手持ちを残した仕事。組の行の大きさは 3×6 のまま */
function withLeftoverStackStock(job: Job, rows: StockRowDraft[], on = true): Job {
  const s = job.stackSheets[0]
  s.stock = stockRows(rows)
  if (on) s.stockOn = true
  return job
}

/** 片の id（重なりを見る） */
function pieceIds(m: MaterialResult | undefined): string[] {
  return m ? m.sheets.flatMap((s) => s.placements.map((p) => p.pieceId)) : []
}

describe('stackChoice は 3×6／4×8 だけ（E-64）', () => {
  it('組の行が 3×6 なら 3×6（手持ち・stockOn は返さない）', () => {
    const job = withLeftoverStackStock(sampleGroupJob(true), [['3×6', 3]])
    expect(stackChoice(job, PAIR)).toEqual({ sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
  })

  it('組の行が無く、2つの材料のサイズがそろわなければ 4×8（第2.6版）', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = []
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
    expect(stackChoice(job, PAIR)).toEqual({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
  })

  it('組の行が自由入力（1000×2000・木目 妻手）なら 4×8', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' }]
    expect(stackChoice(job, PAIR)).toEqual({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
  })

  it('組の行の木目が妻手になっていても 3×6 は長手方向', () => {
    const job = sampleGroupJob(true)
    job.stackSheets[0].grain = 'short'
    expect(stackChoice(job, PAIR).grain).toBe('long')
  })

  it('組の手持ちは選んだサイズ1行（枚数 無限）', () => {
    const job = withLeftoverStackStock(sampleGroupJob(true), [['3×6', 1]])
    expect(availableStackStock(job, PAIR)).toEqual([
      { stockId: null, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: Infinity },
    ])
  })
})

describe('重ね切りの組の木取りは手持ちを使わない（E-64）', () => {
  it('組の行に手持ち 3×6 ×3（stockOn）が残っていても、組は 3×6 で5枚・入らない部材なし', () => {
    const r = run(withLeftoverStackStock(sampleGroupJob(true), [['3×6', 3]]))
    const g = find(r.materials, KEY)!
    expect(g.sheetCount).toBe(5)
    expect(Math.round(g.yieldRate * 1000) / 10).toBe(85.2)
    expect(g.unplaced).toEqual([])
    expect(g.sheets.every((s) => s.sheet === undefined)).toBe(true)
  })

  it('組の行が自由入力 1000×2000 なら、組は 4×8 の大きさで並ぶ', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 1000, length: 2000, grain: 'long' }]
    const g = find(run(job).materials, KEY)!
    expect(g.sheets.every((s) => s.boardWidth === 1220 && s.boardLength === 2440)).toBe(true)
  })

  it('メラミン 1・ラワン 4 ともに材料の手持ち 3×6 ×6 でも、組は組の設定 3×6 で5枚（材料の手持ちを使わない）。背板はラワン 4 の手持ち', () => {
    const r = run(sample([['3×6', 6]], [['3×6', 6]]))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 5, 0],
      [LAUAN_4_ID, 1, 0],
    ])
    expect(find(r.materials, KEY)!.sheets.every((s) => s.sheet === undefined)).toBe(true)
    expect(find(r.materials, LAUAN_4_ID)!.sheets[0].sheet?.stockId).toBe('s1')
  })

  it('メラミン 1 が手持ち 4×8 だけでも、組は組の設定 3×6 で5枚', () => {
    const job = sample([['4×8', 10]], null)
    expect(stackPlan(job).groups.map((g) => g.key)).toEqual([KEY])
    const r = run(job)
    expect(find(r.materials, KEY)!.sheetCount).toBe(5)
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
  })

  it('並び：材料 a のふつうの行 → 組の行 → 材料 b（材料の保存の並び）。片は重ならない', () => {
    const job = sampleGroupJob(true)
    job.parts.push({ ...job.parts[4], id: 'part-mel', name: 'メラミン板', boardId: MELAMINE_1_ID, expr: { W: '300', H: '300', D: `{t:${MELAMINE_1_ID}}` } })
    const r = run(job)
    expect(r.materials.map((m) => m.boardId)).toEqual([MELAMINE_1_ID, KEY, LAUAN_4_ID])
    const ids = r.materials.flatMap((m) => pieceIds(m))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('手持ちの残り・足りないときに組の行は出ない（E-64）', () => {
  it('組の行に手持ちが残っていても stockUsage に組の行は出ない。ラワン 4 の手持ちは背板の1枚だけ数える', () => {
    const job = withStock(withLeftoverStackStock(sampleGroupJob(true), [['3×6', 6]]), LAUAN_4_ID, [['3×6', 1]])
    expect(stockUsage(job, run(job))).toEqual([{ boardId: LAUAN_4_ID, rows: [{ stockId: 's1', label: '3×6', count: 1, used: 1, left: 0 }] }])
  })

  it('組の行に手持ち 3×6 ×1 が残っていても stockShortage は []', () => {
    const job = withLeftoverStackStock(sampleGroupJob(true), [['3×6', 1]])
    expect(stockShortage(job, computeDimensions(job))).toEqual([])
  })

  it('ラワン 4 の手持ちが足りないときは、材料の行だけが出る', () => {
    const job = withStock(withLeftoverStackStock(sampleGroupJob(true), [['3×6', 1]]), LAUAN_4_ID, [{ width: 600, length: 1200, grain: 'long', count: 1 }])
    expect(stockShortage(job, computeDimensions(job)).map((s) => [s.boardId, s.missing])).toEqual([[LAUAN_4_ID, ['背板']]])
  })
})

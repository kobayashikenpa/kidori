// E-61：重ね切りの組の行のサイズの設定（第2.3版。architecture.md 15.2〜15.4）。
// 組は自分のサイズ（3×6／4×8 だけ。組の手持ちは使わない。E-64・15.9）で並べ、材料の行のサイズはその材料のふつうの片だけに効く
import { allStacks } from '../fixtures/stackNew'
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { withStackStock, withStock } from '../fixtures/stock'
import { freezeSheet } from '../progress/frozen'
import type { Job, MaterialResult, SheetLayout } from '../types'
import { packJob } from './index'
import { stackKey } from './stack'
import { availableStock, stackChoice } from './stock'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const
const pct = (r: number) => Math.round(r * 1000) / 10
/** 組はすべて重ねる（組の配置の確かめ。板が増えないかの確かめは stackDecide.test.ts） */
const run = (job: Job) => packJob(job, computeDimensions(job), allStacks(job))
const find = (ms: MaterialResult[], id: string) => ms.find((m) => m.boardId === id)
const names = (s: SheetLayout) => s.placements.map((p) => p.name).join(',')
const size = (s: SheetLayout) => `${s.boardWidth}×${s.boardLength}`

function lauanTo48(job: Job): Job {
  job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
  return job
}

describe('stackChoice（組の行の設定）', () => {
  it('見本の組は 3×6。並びを逆にしても同じ行', () => {
    const job = sampleGroupJob(true)
    expect(stackChoice(job, PAIR)).toMatchObject({ sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
    expect(stackChoice(job, [LAUAN_4_ID, MELAMINE_1_ID]).sizeKind).toBe('saburoku')
  })
  it('行が無く、2つの材料のサイズがそろわなければ 4×8・長手・手持ちなし（第2.6版。どちらも 3×6 なら 3×6）', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = []
    expect(stackChoice(job, PAIR).sizeKind).toBe('saburoku')
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
    expect(stackChoice(job, PAIR)).toEqual({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
  })
})

describe('組の行のサイズで木取り', () => {
  it('組の設定 3×6：組 5枚（85.2%）・ラワン 4 のふつうの1枚が背板の1枚（97.8%）', () => {
    const r = run(sampleGroupJob(true))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 97.8],
    ])
  })

  it('ラワン 4 を 4×8 にしても組は 3×6 で5枚のまま、背板の1枚は 4×8（54.4%）', () => {
    const r = run(lauanTo48(sampleGroupJob(true)))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 54.4],
    ])
    expect(find(r.materials, KEY)!.sheets.every((s) => size(s) === '910×1820')).toBe(true)
    expect(size(find(r.materials, LAUAN_4_ID)!.sheets[0])).toBe('1220×2440')
  })

  it('組の設定が無く材料のサイズがそろわなければ（メラミン 1 が 4×8）組は 4×8 の大きさ（1220×2440）で並び、ラワン 4 は 3×6 のまま', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = []
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
    const r = run(job)
    const g = find(r.materials, KEY)!
    expect(g.sheetCount).toBeGreaterThan(0)
    expect(g.sheets.every((s) => size(s) === '1220×2440')).toBe(true)
    expect(g.unplaced).toEqual([])
    expect(size(find(r.materials, LAUAN_4_ID)!.sheets[0])).toBe('910×1820')
  })

  it('組の設定が自由入力の大きさ（910×1820）でも、組は 4×8 の大きさで並ぶ（組は 3×6／4×8 だけ。E-64）', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 910, length: 1820, grain: 'long' }]
    const g = find(run(job).materials, KEY)!
    expect(g.sheets.every((s) => size(s) === '1220×2440')).toBe(true)
    expect(g.unplaced).toEqual([])
  })

  it('組の設定が自由入力で木目 短手でも、組は 4×8・長手方向で並ぶ（側板も入る）', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 910, length: 1820, grain: 'short' }]
    const g = find(run(job).materials, KEY)!
    expect(g.unplaced).toEqual([])
    expect(g.sheets.flatMap((s) => s.placements.map((p) => p.name))).toContain('側板')
  })

  it('横切り優先・おまかせでも組は5枚（ラワン 4 が 4×8 でも）', () => {
    for (const cutMode of ['horizontal', 'auto'] as const) {
      const job = lauanTo48(sampleGroupJob(true))
      job.settings.cutMode = cutMode
      expect(find(run(job).materials, KEY)!.sheetCount).toBe(5)
    }
  })
})

describe('組は手持ちを使わない（E-64）', () => {
  it('組の行に手持ち 3×6 ×3 が残っていても、組は 3×6 で5枚（棚板も入る）。ラワン 4 は背板の1枚だけ', () => {
    const job = withStackStock(sampleGroupJob(true), PAIR, [['3×6', 3]])
    const r = run(job)
    const g = find(r.materials, KEY)!
    expect(g.sheetCount).toBe(5)
    expect(g.sheets.every((s) => s.sheet === undefined && size(s) === '910×1820')).toBe(true)
    expect(g.unplaced).toEqual([])
    expect(r.materials.map((m) => m.boardId)).toEqual([KEY, LAUAN_4_ID])
    expect(find(r.materials, LAUAN_4_ID)!.sheets.map(names)).toEqual(['背板'])
  })

  it('材料の手持ちは組に使わない（メラミン 1・ラワン 4 に手持ち 3×6 ×1、組は 3×6 の選択 → 組 5枚）', () => {
    const job = withStock(withStock(sampleGroupJob(true), MELAMINE_1_ID, [['3×6', 1]]), LAUAN_4_ID, [['3×6', 1]])
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 5, 0],
      [LAUAN_4_ID, 1, 0],
    ])
  })
})

describe('固定した1枚と手持ち（availableStock）', () => {
  function frozenStack(job: Job, stack: boolean) {
    const g = find(run(job).materials, KEY)!
    return freezeSheet(job, MELAMINE_1_ID, 'vertical', g.sheets[0], 'f1', new Date('2026-09-28T00:00:00Z'), stack ? LAUAN_4_ID : undefined)
  }

  it('組の固定した1枚は材料の手持ちから引かない。組は何枚でも（組の片の残りだけ並ぶ）', () => {
    const job = withStock(sampleGroupJob(true), LAUAN_4_ID, [['3×6', 1]])
    job.frozenSheets = [frozenStack(job, true)]
    expect(availableStock(job, LAUAN_4_ID).map((k) => k.count)).toEqual([1])
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 4, 0],
      [LAUAN_4_ID, 1, 0],
    ])
  })

  it('材料だけの固定した1枚（stackWith なし）は材料の手持ちから引く', () => {
    const job = withStock(sampleGroupJob(true), MELAMINE_1_ID, [['3×6', 2]])
    job.frozenSheets = [frozenStack(job, false)]
    expect(availableStock(job, MELAMINE_1_ID).map((k) => k.count)).toEqual([1])
  })

  it('freezeSheet：組の1枚の木目は組の設定から（材料 a が短手でも長手。組の行が自由入力・短手でも 4×8 の長手）', () => {
    const job = sampleGroupJob(true)
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, sizeKind: 'custom', grain: 'short' } : b))
    expect(frozenStack(job, true).grain).toBe('long')
    job.stackSheets[0].grain = 'short'
    job.stackSheets[0].sizeKind = 'custom'
    const layout = find(run(job).materials, KEY)!.sheets[0]
    expect(freezeSheet(job, MELAMINE_1_ID, 'vertical', layout, 'f', new Date(), LAUAN_4_ID).grain).toBe('long')
  })
})

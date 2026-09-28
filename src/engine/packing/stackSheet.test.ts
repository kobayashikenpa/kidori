// E-61：重ね切りの組の行のサイズの設定（第2.3版。architecture.md 15.2〜15.4）。
// 組は自分のサイズ（または組の手持ち）で並べ、材料の行のサイズはその材料のふつうの片だけに効く
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../fixtures/flush'
import { withStackStock, withStock } from '../fixtures/stock'
import { freezeSheet } from '../progress/frozen'
import type { Job, MaterialResult, SheetLayout } from '../types'
import { packJob } from './index'
import { stackKey } from './stack'
import { availableStackStock, availableStock, stackChoice } from './stock'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const
const pct = (r: number) => Math.round(r * 1000) / 10
const run = (job: Job) => packJob(job, computeDimensions(job))
const find = (ms: MaterialResult[], id: string) => ms.find((m) => m.boardId === id)
const names = (s: SheetLayout) => s.placements.map((p) => p.name).join(',')
const size = (s: SheetLayout) => `${s.boardWidth}×${s.boardLength}`

function lauanTo48(job: Job): Job {
  job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
  return job
}

describe('stackChoice（組の行の設定）', () => {
  it('見本の組は 3×6。並びを逆にしても同じ行', () => {
    const job = sampleFlushJob(true)
    expect(stackChoice(job, PAIR)).toMatchObject({ sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
    expect(stackChoice(job, [LAUAN_4_ID, MELAMINE_1_ID]).sizeKind).toBe('saburoku')
  })
  it('行が無ければ 4×8・長手・手持ちなし', () => {
    const job = sampleFlushJob(true)
    job.stackSheets = []
    expect(stackChoice(job, PAIR)).toEqual({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
  })
})

describe('組の行のサイズで木取り', () => {
  it('組の設定 3×6：組 5枚（85.2%）・ラワン 4 のふつうの1枚が背板の1枚（97.8%）', () => {
    const r = run(sampleFlushJob(true))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 97.8],
    ])
  })

  it('ラワン 4 を 4×8 にしても組は 3×6 で5枚のまま、背板の1枚は 4×8（54.4%）', () => {
    const r = run(lauanTo48(sampleFlushJob(true)))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 54.4],
    ])
    expect(find(r.materials, KEY)!.sheets.every((s) => size(s) === '910×1820')).toBe(true)
    expect(size(find(r.materials, LAUAN_4_ID)!.sheets[0])).toBe('1220×2440')
  })

  it('組の設定が無ければ組は 4×8 の大きさ（1220×2440）で並び、ラワン 4 は 3×6 のまま', () => {
    const job = sampleFlushJob(true)
    job.stackSheets = []
    const r = run(job)
    const g = find(r.materials, KEY)!
    expect(g.sheetCount).toBeGreaterThan(0)
    expect(g.sheets.every((s) => size(s) === '1220×2440')).toBe(true)
    expect(g.unplaced).toEqual([])
    expect(size(find(r.materials, LAUAN_4_ID)!.sheets[0])).toBe('910×1820')
  })

  it('組の設定を自由入力の大きさ（手持ちでない、以前の自由入力）にすると、その大きさで何枚でも並ぶ', () => {
    const job = sampleFlushJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 910, length: 1820, grain: 'long' }]
    expect(find(run(job).materials, KEY)!.sheetCount).toBe(5)
  })

  it('組の木目が短手なら、片の向きは組の木目に合わせる（入らない片は組の tooLarge）', () => {
    const job = sampleFlushJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 910, length: 1820, grain: 'short' }]
    const g = find(run(job).materials, KEY)!
    // 側板（木目 H＝1800 を短辺方向に）は短辺 905 に入らない
    expect(g.unplaced).toEqual([{ partId: 'part-gawa', name: '側板', reason: 'tooLarge' }])
    expect(g.sheets.flatMap((s) => s.placements.map((p) => p.name))).not.toContain('側板')
  })

  it('横切り優先・おまかせでも組は5枚（ラワン 4 が 4×8 でも）', () => {
    for (const cutMode of ['horizontal', 'auto'] as const) {
      const job = lauanTo48(sampleFlushJob(true))
      job.settings.cutMode = cutMode
      expect(find(run(job).materials, KEY)!.sheetCount).toBe(5)
    }
  })
})

describe('組の手持ち（組の行の自由入力）', () => {
  it('組の手持ち 3×6 ×3 → 組 3枚（側板×2／側板×2／天地板×4）で、組に 棚板 が noStock。ラワン 4 は背板の1枚だけ', () => {
    const job = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 3]])
    const r = run(job)
    const g = find(r.materials, KEY)!
    expect(g.sheets.map(names)).toEqual(['側板,側板', '側板,側板', '天地板,天地板,天地板,天地板'])
    expect(g.sheets.every((s) => s.sheet?.stockId === 's1')).toBe(true)
    expect(g.unplaced).toEqual([{ partId: 'part-tana', name: '棚板', reason: 'noStock' }])
    expect(r.materials.map((m) => m.boardId)).toEqual([KEY, LAUAN_4_ID])
    expect(find(r.materials, LAUAN_4_ID)!.sheets.map(names)).toEqual(['背板'])
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
  })

  it('組の手持ち 3×6 ×5・ラワン 4 の手持ち 3×6 ×1 → 入らない部材なし（材料の手持ちから組の分を引かない）', () => {
    const job = withStock(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 5]]), LAUAN_4_ID, [['3×6', 1]])
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 5, 0],
      [LAUAN_4_ID, 1, 0],
    ])
  })

  it('材料の手持ちは組に使わない（メラミン 1・ラワン 4 に手持ち 3×6 ×1、組は 3×6 の選択 → 組 5枚）', () => {
    const job = withStock(withStock(sampleFlushJob(true), MELAMINE_1_ID, [['3×6', 1]]), LAUAN_4_ID, [['3×6', 1]])
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 5, 0],
      [LAUAN_4_ID, 1, 0],
    ])
  })

  it('組の手持ちに 4×8 と 3×6 が混ざると、1枚ごとにその大きさ（入らない部材なし）', () => {
    const job = withStackStock(sampleFlushJob(true), PAIR, [['3×6', 1], ['4×8', 5]])
    const g = find(run(job).materials, KEY)!
    expect(g.unplaced).toEqual([])
    expect(g.sheets.some((s) => s.sheet?.stockId === 's2')).toBe(true)
  })
})

describe('固定した1枚と手持ち（availableStock・availableStackStock）', () => {
  function frozenStack(job: Job, stack: boolean) {
    const g = find(run(job).materials, KEY)!
    return freezeSheet(job, MELAMINE_1_ID, 'vertical', g.sheets[0], 'f1', new Date('2026-09-28T00:00:00Z'), stack ? LAUAN_4_ID : undefined)
  }

  it('組の固定した1枚は組の手持ちから引き、材料の手持ちからは引かない', () => {
    const job = withStock(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 5]]), LAUAN_4_ID, [['3×6', 1]])
    job.frozenSheets = [frozenStack(job, true)]
    expect(availableStackStock(job, PAIR).map((k) => k.count)).toEqual([4])
    expect(availableStackStock(job, [LAUAN_4_ID, MELAMINE_1_ID]).map((k) => k.count)).toEqual([4])
    expect(availableStock(job, LAUAN_4_ID).map((k) => k.count)).toEqual([1])
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 4, 0],
      [LAUAN_4_ID, 1, 0],
    ])
  })

  it('材料だけの固定した1枚（stackWith なし）は材料の手持ちから引く', () => {
    const job = withStock(withStackStock(sampleFlushJob(true), PAIR, [['3×6', 5]]), MELAMINE_1_ID, [['3×6', 2]])
    job.frozenSheets = [frozenStack(job, false)]
    expect(availableStock(job, MELAMINE_1_ID).map((k) => k.count)).toEqual([1])
    expect(availableStackStock(job, PAIR).map((k) => k.count)).toEqual([5])
  })

  it('組が手持ちでなければ availableStackStock は組の大きさが何枚でも（1行・Infinity）', () => {
    expect(availableStackStock(sampleFlushJob(true), PAIR)).toEqual([
      { stockId: null, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: Infinity },
    ])
  })

  it('freezeSheet：組の1枚の木目は組の設定から（材料 a が短手でも、組が長手なら長手）', () => {
    const job = sampleFlushJob(true)
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, sizeKind: 'custom', grain: 'short' } : b))
    expect(frozenStack(job, true).grain).toBe('long')
    job.stackSheets[0].grain = 'short'
    job.stackSheets[0].sizeKind = 'custom'
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, grain: 'long', sizeKind: 'saburoku' } : b))
    const layout = find(run(job).materials, KEY)!.sheets[0]
    expect(freezeSheet(job, MELAMINE_1_ID, 'vertical', layout, 'f', new Date(), LAUAN_4_ID).grain).toBe('short')
  })
})

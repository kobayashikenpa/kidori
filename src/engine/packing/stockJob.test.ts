// E-57：手持ちで木取りする入口（固定した1枚・おまかせ・サイズの比較）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { withStock, type StockRowDraft } from '../fixtures/stock'
import { freezeSheet } from '../progress/frozen'
import type { CutMode, Job, MaterialResult, SheetLayout } from '../types'
import { packJob } from './index'
import { compareStandardSizes } from './sizes'
import { availableStock } from './stock'

const NOW = new Date('2026-09-27T00:00:00.000Z')

function run(job: Job) {
  return packJob(job, computeDimensions(job))
}

function lumber(job: Job): MaterialResult {
  return run(job).materials.find((m) => m.boardId === LUMBER_18_ID)!
}

function stocked(rows: StockRowDraft[], mode: CutMode = 'vertical'): Job {
  const job = withStock(bookshelfJob(), LUMBER_18_ID, rows)
  job.settings.cutMode = mode
  return job
}

const names = (s: SheetLayout) => s.placements.map((p) => p.name).sort()
const withoutSheet = (s: SheetLayout) => {
  const { sheet: _sheet, ...rest } = s
  return rest
}

/** 1つ目の計算した1枚を固定する（completed なら切り終わりにする） */
function freezeFirst(job: Job, completed = false): Job {
  const m = lumber(job)
  const f = freezeSheet(job, LUMBER_18_ID, m.mode, m.sheets[0], 'f1', NOW)
  if (completed) {
    f.checked = f.layout.placements.map((p) => p.pieceId)
    f.completedAt = NOW.toISOString()
  }
  job.frozenSheets.push(f)
  return job
}

describe('packJob：手持ちで木取り', () => {
  it('3×6 ×3 → 今と同じ3枚・同じ配置で、1枚ごとに sheet が付く', () => {
    const before = lumber(bookshelfJob())
    const after = lumber(stocked([['3×6', 3]]))
    expect(after.sheetCount).toBe(3)
    expect(after.sheets.map(withoutSheet)).toEqual(before.sheets)
    expect(after.sheets.map((s) => s.sheet)).toEqual([
      { stockId: 's1', sizeKind: 'saburoku', grain: 'long' },
      { stockId: 's1', sizeKind: 'saburoku', grain: 'long' },
      { stockId: 's1', sizeKind: 'saburoku', grain: 'long' },
    ])
    expect(after.unplaced).toEqual([])
    expect(after.yieldRate).toBeCloseTo(before.yieldRate, 10)
  })

  it('手持ちの無い材料（シナベニヤ）は sheet を持たない', () => {
    const r = run(stocked([['3×6', 3]]))
    expect(r.materials.find((m) => m.boardId !== LUMBER_18_ID)!.sheets[0].sheet).toBeUndefined()
  })

  it('3×6 ×2 → 2枚と、入らない部材 棚板（noStock）', () => {
    const m = lumber(stocked([['3×6', 2]]))
    expect(m.sheetCount).toBe(2)
    expect(m.sheets.map(names)).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板'],
    ])
    expect(m.unplaced).toEqual([{ partId: 'part-tanaita', name: '棚板', reason: 'noStock' }])
  })

  it('4×8 ×2 → 2枚で入らない部材なし。1枚ごとの大きさは 1220×2440', () => {
    const m = lumber(stocked([['4×8', 2]]))
    expect(m.sheetCount).toBe(2)
    expect(m.unplaced).toEqual([])
    expect(m.sheets.map((s) => [s.boardWidth, s.boardLength, s.usable.w, s.usable.h])).toEqual([
      [1220, 2440, 1215, 2440],
      [1220, 2440, 1215, 2440],
    ])
    // 切る順番の最初は、その1枚の大きさの端切り
    expect(m.sheets[0].cuts[0]).toMatchObject({ kind: 'trim', at: 1215 })
  })

  it('3×6 ×1・4×8 ×1 → 1枚目 3×6（側板×2）、2枚目 4×8。歩留まりの分母は1枚ごとの面積', () => {
    const m = lumber(stocked([['3×6', 1], ['4×8', 1]]))
    expect(m.sheets.map((s) => s.sheet?.sizeKind)).toEqual(['saburoku', 'shihachi'])
    const used = m.sheets.reduce((a, s) => a + s.usedArea, 0)
    expect(m.yieldRate).toBeCloseTo(used / (910 * 1820 + 1220 * 2440), 10)
  })

  it('3×6 ×2 で1枚目（側板×2）を固定すると、計算した1枚は1枚（天地板×2＋棚板×2）で棚板が noStock', () => {
    const job = freezeFirst(stocked([['3×6', 2]]))
    expect(availableStock(job, LUMBER_18_ID).map((k) => k.count)).toEqual([1])
    const m = lumber(job)
    expect(m.sheets.map(names)).toEqual([['天地板', '天地板', '棚板', '棚板']])
    expect(m.unplaced).toEqual([{ partId: 'part-tanaita', name: '棚板', reason: 'noStock' }])
  })

  it('その1枚を切り終わりにしても同じ（切り終わりも手持ちから引く。未決事項 40）', () => {
    const job = freezeFirst(stocked([['3×6', 2]]), true)
    const m = lumber(job)
    expect(m.sheets.map(names)).toEqual([['天地板', '天地板', '棚板', '棚板']])
    expect(m.unplaced.map((u) => u.reason)).toEqual(['noStock'])
  })

  it('固定した1枚と大きさのそろう行が無ければ引かない', () => {
    const job = freezeFirst(stocked([['3×6', 2]]))
    job.boards[0].stock = [{ id: 'x', sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long', count: 2 }]
    expect(availableStock(job, LUMBER_18_ID).map((k) => k.count)).toEqual([2])
  })

  it('サイズを選んだ材料の availableStock は選んだサイズ1行・無限', () => {
    const job = freezeFirst(bookshelfJob())
    expect(availableStock(job, LUMBER_18_ID)).toEqual([
      { stockId: null, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: Infinity },
    ])
  })

  it('3×6 ×2 のときもサイズの比較は 3×6 3枚・4×8 2枚（比較は手持ちを使わない）', () => {
    const job = stocked([['3×6', 2]])
    const c = compareStandardSizes(job, computeDimensions(job)).find((x) => x.boardId === LUMBER_18_ID)!
    expect(c.options.map((o) => [o.kind, o.sheetCount, o.unplacedCount])).toEqual([
      ['saburoku', 3, 0],
      ['shihachi', 2, 0],
    ])
  })

  it('おまかせ：入らない片 → 枚数 → 使った面積の合計 の順で比べる', () => {
    // 3×6 ×1・4×8 ×1 は縦・横どちらも2枚。面積が同じなら今までどおり端材で比べる
    const m = lumber(stocked([['3×6', 1], ['4×8', 1]], 'auto'))
    expect(m.sheetCount).toBe(2)
    expect(m.unplaced).toEqual([])
    // 3×6 ×2 は縦・横どちらも棚板が入らない → 同じ扱い
    const n = lumber(stocked([['3×6', 2]], 'auto'))
    expect(n.unplaced.map((u) => u.name)).toEqual(['棚板'])
  })

  it('横切り優先でも手持ちの1枚は横長で、その大きさの端切りをする', () => {
    const m = lumber(stocked([['4×8', 2]], 'horizontal'))
    expect(m.mode).toBe('horizontal')
    expect(m.sheets[0].orientation).toBe('landscape')
    expect(m.sheets[0].usable).toEqual({ x: 0, y: 5, w: 2435, h: 1215 })
  })
})

describe('packJob：手持ちの計算の速さ', () => {
  it('部材150枚・手持ち3行・おまかせで 1秒以内', () => {
    const job = bookshelfJob()
    job.settings.cutMode = 'auto'
    job.parts = job.parts.filter((p) => p.name === '全体')
    for (let i = 0; i < 10; i++) {
      job.parts.push({
        id: `p${i}`,
        name: `部材${i}`,
        boardId: LUMBER_18_ID,
        expr: { W: String(150 + i * 70), H: '18', D: String(200 + ((i * 97) % 500)) },
        thicknessAxis: null,
        quantity: 15,
        grain: i % 2 === 0 ? 'W' : 'any',
        memo: '',
        checks: { finished: false, cut: false },
        allowance: 10,
      })
    }
    withStock(job, LUMBER_18_ID, [['3×6', 5], ['4×8', 4], { width: 600, length: 1820, grain: 'long', count: 10 }])
    const t0 = performance.now()
    const r = run(job)
    expect(performance.now() - t0).toBeLessThan(1000)
    const m = r.materials.find((x) => x.boardId === LUMBER_18_ID)!
    const placed = m.sheets.reduce((a, s) => a + s.placements.length, 0)
    expect(placed).toBeGreaterThan(0)
  })
})

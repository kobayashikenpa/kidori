import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import { packGuillotine } from './guillotine'
import { expandPieces } from './pieces'
import { usableRect } from './sheet'
import { combineYield, sheetYield } from './yield'

const pct = (r: number) => Math.round(r * 1000) / 10
const SABUROKU = { width: 910, length: 1820 }

function sheetYields(boardId: string) {
  const job = bookshelfJob()
  const g = expandPieces(job, computeDimensions(job)).groups.find((x) => x.board.id === boardId)!
  const r = packGuillotine(g.pieces, usableRect(g.board, 5), 3, 'vertical')
  return r.sheets.map((sh) => sheetYield(sh.strips.flatMap((s) => s.items.map((i) => i.placement)), g.board))
}

describe('歩留まり（木取り寸法の面積 ÷ 板全体の面積）', () => {
  it('板1枚：側板2枚 1810×410 ×2 ÷ 910×1820 = 89.6%', () => {
    const y = sheetYield(
      [
        { x: 495, y: 10, w: 410, h: 1810 },
        { x: 82, y: 10, w: 410, h: 1810 },
      ],
      SABUROKU,
    )
    expect(y.usedArea).toBe(1_484_200)
    expect(y.boardArea).toBe(1_656_200)
    expect(pct(y.yieldRate)).toBe(89.6)
  })

  it('見本・縦切り優先：ランバー 1枚目 89.6%、2枚目 84.4%、3枚目 41.1%', () => {
    expect(sheetYields(LUMBER_18_ID).map((y) => pct(y.yieldRate))).toEqual([89.6, 84.4, 41.1])
  })

  it('見本・縦切り優先：ランバー全体 71.7%、ベニヤ 97.8%、全体 78.2%', () => {
    const lumber = sheetYields(LUMBER_18_ID)
    const veneer = sheetYields(VENEER_4_ID)
    expect(pct(combineYield(lumber).yieldRate)).toBe(71.7)
    expect(pct(combineYield(veneer).yieldRate)).toBe(97.8)
    expect(pct(combineYield([...lumber, ...veneer]).yieldRate)).toBe(78.2)
  })

  it('まとめた面積は合計になる', () => {
    const c = combineYield(sheetYields(LUMBER_18_ID))
    expect(c.usedArea).toBe(1_484_200 + 1_397_620 + 680_940)
    expect(c.boardArea).toBe(1_656_200 * 3)
  })

  it('板がなければ歩留まり 0（0 で割らない）', () => {
    expect(combineYield([])).toEqual({ usedArea: 0, boardArea: 0, yieldRate: 0 })
    expect(sheetYield([], { width: 0, length: 0 }).yieldRate).toBe(0)
  })
})

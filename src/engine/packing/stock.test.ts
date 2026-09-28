import { describe, expect, it } from 'vitest'
import type { Board, StockSheet } from '../types'
import { stockKinds, stockSizeLabel } from './stock'

const SABUROKU = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
const SHIHACHI = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const

function board(p: Partial<Board> = {}): Board {
  return { id: 'b', material: 'ラワン', thickness: 4, ...SHIHACHI, ...p }
}

function row(id: string, size: typeof SABUROKU | typeof SHIHACHI, count: number): StockSheet {
  return { id, ...size, count }
}

describe('stockKinds（材料の手持ち）', () => {
  it('手持ちの無い材料は、選んだサイズ1行・枚数 Infinity', () => {
    expect(stockKinds(board())).toEqual([{ stockId: null, ...SHIHACHI, count: Infinity }])
  })

  it('stockOn なら手持ちの行（登録順）', () => {
    const b = board({ stockOn: true, stock: [row('s1', SHIHACHI, 3), row('s2', SABUROKU, 2)] })
    expect(stockKinds(b)).toEqual([
      { stockId: 's1', ...SHIHACHI, count: 3 },
      { stockId: 's2', ...SABUROKU, count: 2 },
    ])
  })

  it('stockOn を外すと、行があっても選んだサイズ1行', () => {
    const b = board({ stock: [row('s1', SABUROKU, 3)] })
    expect(stockKinds(b)).toEqual([{ stockId: null, ...SHIHACHI, count: Infinity }])
  })
})

describe('stockSizeLabel', () => {
  it('3×6・4×8・自由入力（短辺×長辺）', () => {
    expect(stockSizeLabel(SABUROKU)).toBe('3×6')
    expect(stockSizeLabel(SHIHACHI)).toBe('4×8')
    expect(stockSizeLabel({ sizeKind: 'custom', width: 450, length: 900 })).toBe('450×900')
    expect(stockSizeLabel({ sizeKind: 'custom', width: 450.25, length: 900 })).toBe('450.3×900')
  })
})

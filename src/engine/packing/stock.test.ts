import { describe, expect, it } from 'vitest'
import type { Board, StockSheet } from '../types'
import { commonStock, stockKinds, stockSizeLabel } from './stock'

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

describe('commonStock（組の手持ち）', () => {
  const a = stockKinds(board({ stockOn: true, stock: [row('a1', SABUROKU, 5), row('a2', SHIHACHI, 2)] }))

  it('大きさ・木目がそろう行どうし、枚数は少ないほう', () => {
    const b = stockKinds(board({ stockOn: true, stock: [row('b1', SABUROKU, 3)] }))
    expect(commonStock(a, b)).toEqual([{ stockId: 'a1', ...SABUROKU, count: 3 }])
  })

  it('b が 3×6 の選択（無限）なら 3×6 ×5', () => {
    const b = stockKinds(board({ ...SABUROKU }))
    expect(commonStock(a, b)).toEqual([{ stockId: 'a1', ...SABUROKU, count: 5 }])
  })

  it('a が選択（無限）で b が手持ちなら、b の行の id と枚数', () => {
    const sel = stockKinds(board({ ...SABUROKU }))
    const b = stockKinds(board({ stockOn: true, stock: [row('b1', SHIHACHI, 4), row('b2', SABUROKU, 3)] }))
    expect(commonStock(sel, b)).toEqual([{ stockId: 'b2', ...SABUROKU, count: 3 }])
  })

  it('どちらも選択なら、そろえば無限の1行・そろわなければ空', () => {
    expect(commonStock(stockKinds(board({ ...SABUROKU })), stockKinds(board({ ...SABUROKU })))).toEqual([
      { stockId: null, ...SABUROKU, count: Infinity },
    ])
    expect(commonStock(stockKinds(board({ ...SABUROKU })), stockKinds(board()))).toEqual([])
  })

  it('自由入力 910×1820 木目 長手 は 3×6 とそろい、木目 短手 はそろわない', () => {
    const custom = (grain: 'long' | 'short') =>
      stockKinds(board({ stockOn: true, stock: [{ id: 'c', sizeKind: 'custom', width: 910, length: 1820, grain, count: 2 }] }))
    const sel = stockKinds(board({ ...SABUROKU }))
    expect(commonStock(custom('long'), sel)).toEqual([{ stockId: 'c', sizeKind: 'custom', width: 910, length: 1820, grain: 'long', count: 2 }])
    expect(commonStock(custom('short'), sel)).toEqual([])
  })

  it('同じ大きさの行が何行あっても、相手の枚数を二重に使わない', () => {
    const b = stockKinds(board({ stockOn: true, stock: [row('b1', SABUROKU, 2), row('b2', SABUROKU, 2)] }))
    const a2 = stockKinds(board({ stockOn: true, stock: [row('a1', SABUROKU, 3), row('a2', SABUROKU, 3)] }))
    expect(commonStock(a2, b).map((k) => [k.stockId, k.count])).toEqual([
      ['a1', 3],
      ['a2', 1],
    ])
  })
})

// E-56：帯詰めを「1枚ごとの大きさ」と「入る一番小さい手持ち」に対応させる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { packGuillotine, packOnStock, type StockPackResult } from './guillotine'
import { expandPieces, type Piece } from './pieces'
import { usableRect } from './sheet'
import type { StockKind } from './stock'

const S36 = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const

function kind(id: string, size: typeof S36 | typeof S48, count: number): StockKind {
  return { stockId: id, ...size, count }
}

function lumberPieces(): Piece[] {
  const job = bookshelfJob()
  return expandPieces(job, computeDimensions(job)).groups.find((g) => g.board.id === LUMBER_18_ID)!.pieces
}

function names(r: StockPackResult): string[][] {
  return r.sheets.map((sh) => sh.strips.flatMap((s) => s.items.map((i) => i.placement.name)).sort())
}

describe('packOnStock（手持ちで帯詰め）', () => {
  it('選んだサイズ（1行・無限）なら packGuillotine と同じ配置', () => {
    const pieces = lumberPieces()
    for (const mode of ['vertical', 'horizontal'] as const) {
      const a = packOnStock(pieces, [{ stockId: null, ...S36, count: Infinity }], 5, 3, mode)
      const b = packGuillotine(pieces, usableRect(S36, 5, mode), 3, mode)
      expect(a.sheets.map((s) => s.strips)).toEqual(b.sheets.map((s) => s.strips))
      expect(a.unplaced).toEqual([])
    }
  })

  it('見本の片を 3×6 ×2 で並べると2枚で、棚板2片が入らない片', () => {
    const r = packOnStock(lumberPieces(), [kind('s', S36, 2)], 5, 3, 'vertical')
    expect(names(r)).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板'],
    ])
    expect(r.unplaced.map((p) => p.name)).toEqual(['棚板', '棚板'])
    expect(r.sheets.map((s) => s.stock.stockId)).toEqual(['s', 's'])
  })

  it('4×8 ×1・3×6 ×5 なら 3×6 を3枚使い、4×8 は使わない（入る一番小さい手持ち）', () => {
    const r = packOnStock(lumberPieces(), [kind('big', S48, 1), kind('small', S36, 5)], 5, 3, 'vertical')
    expect(r.sheets.map((s) => s.stock.stockId)).toEqual(['small', 'small', 'small'])
    expect(r.unplaced).toEqual([])
  })

  it('3×6 ×1・4×8 ×1 なら 1枚目 3×6（側板×2）、2枚目 4×8（天地板×2＋棚板×4）', () => {
    const r = packOnStock(lumberPieces(), [kind('small', S36, 1), kind('big', S48, 1)], 5, 3, 'vertical')
    expect(r.sheets.map((s) => s.stock.stockId)).toEqual(['small', 'big'])
    expect(names(r)).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板', '棚板', '棚板'],
    ])
    expect(r.unplaced).toEqual([])
    // 4×8 の1枚は自分の使える範囲（1215×2440）の右上から詰める
    const first = r.sheets[1].strips[0].items[0].placement
    expect(first.x + first.w).toBe(1215)
    expect(first.y + first.h).toBe(2440)
  })

  it('同じ面積なら登録順で前の行を使う', () => {
    const r = packOnStock(lumberPieces(), [kind('a', S36, 1), kind('b', S36, 5)], 5, 3, 'vertical')
    expect(r.sheets.map((s) => s.stock.stockId)).toEqual(['a', 'b', 'b'])
  })

  it('木目：短辺方向の自由入力 1820×910 には、木目 H の側板（1810 を長辺に通す）が入らない', () => {
    const short: StockKind = { stockId: 'c', sizeKind: 'custom', width: 910, length: 1820, grain: 'short', count: 5 }
    const r = packOnStock(lumberPieces(), [short], 5, 3, 'vertical')
    // 側板は木目 H（1810 の軸）を木目に通すので、木目が短辺方向の板では 1810 が短辺（905）方向になり入らない
    expect(r.unplaced.map((p) => p.name)).toEqual(['側板', '側板'])
  })

  it('一番小さい手持ちに入らない片は、入る大きい手持ちを使う（小さい手持ちが残っていても）', () => {
    const tiny: StockKind = { stockId: 't', sizeKind: 'custom', width: 450, length: 900, grain: 'long', count: 9 }
    const r = packOnStock(lumberPieces(), [tiny, kind('small', S36, 9)], 5, 3, 'vertical')
    // 側板（1810）・天地板（874）・棚板（873）：450×900 の使える範囲は 445×900 なので天地板・棚板は入る
    expect(r.sheets.filter((s) => s.stock.stockId === 'small')).toHaveLength(1)
    expect(names(r)[0]).toEqual(['側板', '側板'])
    expect(r.unplaced).toEqual([])
  })
})

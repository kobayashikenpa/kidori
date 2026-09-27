// 手持ちの材料（第2.2版。architecture.md 14.3）。
// どの材料も「手持ち」で木取りする。サイズを1つ選んだ材料は、そのサイズが無限にある手持ち（1行・枚数 Infinity）とみなす
import { round1 } from '../round'
import type { Board, BoardGrain, BoardSizeKind } from '../types'

/** 材料の手持ちの1行（木取りに使う形） */
export interface StockKind {
  /** 手持ちの行の id。サイズを選んだ材料は null */
  stockId: string | null
  sizeKind: BoardSizeKind
  /** 短辺 */
  width: number
  /** 長辺 */
  length: number
  grain: BoardGrain
  /** 使える枚数。サイズを選んだ材料は Infinity */
  count: number
}

type SheetSize = Pick<StockKind, 'width' | 'length' | 'grain'>

/** 手持ちで木取りする材料か（stockOn が true で、行が1つ以上） */
export function usesStock(board: Pick<Board, 'stockOn' | 'stock'>): boolean {
  return board.stockOn === true && (board.stock?.length ?? 0) > 0
}

/** stockOn なら手持ちの行（登録順）、そうでなければ選んだサイズ1行（枚数 Infinity） */
export function stockKinds(board: Board): StockKind[] {
  if (usesStock(board)) {
    return board.stock!.map((s) => ({
      stockId: s.id,
      sizeKind: s.sizeKind,
      width: s.width,
      length: s.length,
      grain: s.grain,
      count: s.count,
    }))
  }
  return [{ stockId: null, sizeKind: board.sizeKind, width: board.width, length: board.length, grain: board.grain, count: Infinity }]
}

/** 3×6 → "3×6"、4×8 → "4×8"、自由入力 → "450×900"（短辺×長辺） */
export function stockSizeLabel(s: Pick<StockKind, 'sizeKind' | 'width' | 'length'>): string {
  if (s.sizeKind === 'saburoku') return '3×6'
  if (s.sizeKind === 'shihachi') return '4×8'
  return `${round1(s.width)}×${round1(s.length)}`
}

/** 大きさ（小数第1位）と木目が同じか（選び方 3×6／自由入力 は見ない。未決事項 38 と同じ） */
export function sameStockSize(a: SheetSize, b: SheetSize): boolean {
  return round1(a.width) === round1(b.width) && round1(a.length) === round1(b.length) && a.grain === b.grain
}

/**
 * 重ね切りの組の手持ち：大きさ・木目がそろう行どうしで、枚数は少ないほう。並びは a の順。
 * 同じ大きさの行がいくつあっても、相手の枚数を二重には使わない（前の行から順に割り当てる）。
 * id は a の行の id（a がサイズを選んだ材料なら b の行の id）。どちらもサイズを選んだ材料なら、そろえば無限の1行
 */
export function commonStock(a: readonly StockKind[], b: readonly StockKind[]): StockKind[] {
  const rest = b.map((k) => k.count)
  const out: StockKind[] = []
  for (const ka of a) {
    let left = ka.count
    while (left > 0) {
      const j = b.findIndex((kb, i) => rest[i] > 0 && sameStockSize(ka, kb))
      if (j < 0) break
      const n = Math.min(left, rest[j])
      const stockId = ka.stockId ?? b[j].stockId
      const last = out[out.length - 1]
      if (last && last.stockId === stockId && last.stockId !== null && sameStockSize(last, ka)) last.count += n
      else out.push({ ...ka, stockId, count: n })
      if (n === Infinity) break
      left -= n
      rest[j] -= n
    }
  }
  return out
}

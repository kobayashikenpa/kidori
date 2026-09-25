// 板の置き方・使える範囲（端切り）と、刃厚込みで入るかの判定
// - 縦切り優先：板を縦長に置く（portrait）。x：短辺方向 0〜width、y：長辺方向 0〜length。端切りは右の長手
// - 横切り優先：板を横長に置く（landscape）。x：長辺方向 0〜length、y：短辺方向 0〜width。
//   端切りは上の長手 → 右の妻手の順（右上の角の矩を出す）
// どちらも左下を原点とし、端切りの幅は刃厚を含む
import { round1 } from '../round'
import type { Board, Rect, SheetOrientation } from '../types'

/** 切り方（おまかせを除く） */
export type StripMode = 'vertical' | 'horizontal'

export function sheetOrientation(mode: StripMode): SheetOrientation {
  return mode === 'horizontal' ? 'landscape' : 'portrait'
}

type BoardSize = Pick<Board, 'width' | 'length'>

/**
 * 端切り後に使える範囲（その置き方の座標）。
 * サブロク・端切り5：縦切り優先なら x 0〜905・y 0〜1820、横切り優先なら x 0〜1815・y 0〜905
 */
export function usableRect(board: BoardSize, trim: number, mode: StripMode = 'vertical'): Rect {
  const short = round1(Math.max(0, board.width - trim))
  if (mode === 'horizontal') {
    return { x: 0, y: 0, w: round1(Math.max(0, board.length - trim)), h: short }
  }
  return { x: 0, y: 0, w: short, h: board.length }
}

/** 使える範囲の大きさを板の辺で表したもの（short：妻手方向、long：長手方向） */
export function usableSides(board: BoardSize, trim: number, mode: StripMode): { short: number; long: number } {
  const u = usableRect(board, trim, mode)
  return mode === 'horizontal' ? { short: u.h, long: u.w } : { short: u.w, long: u.h }
}

/** 端切りで落とす部分（切る順番と同じ並び）。端切り0 なら空 */
export function trimRects(board: BoardSize, trim: number, mode: StripMode): Rect[] {
  if (round1(trim) <= 0) return []
  const u = usableRect(board, trim, mode)
  if (mode === 'horizontal') {
    return [
      // 上の長手（全長）
      { x: 0, y: u.h, w: board.length, h: round1(board.width - u.h) },
      // 右の妻手（上を落とした残りの高さ）
      { x: u.w, y: 0, w: round1(board.length - u.w), h: u.h },
    ]
  }
  return [{ x: u.w, y: 0, w: round1(board.width - u.w), h: board.length }]
}

/** 片を一列に並べたときに使う長さ：片の合計 + 刃厚 ×（枚数 − 1）。板の端では刃厚を引かない */
export function lengthUsed(sizes: readonly number[], kerf: number): number {
  if (sizes.length === 0) return 0
  let sum = 0
  for (const s of sizes) sum += s
  return round1(sum + kerf * (sizes.length - 1))
}

/** 長さ L の中に片を刃厚込みで並べられるか（小数第1位に丸めて比べる） */
export function fitsInLength(sizes: readonly number[], kerf: number, length: number): boolean {
  return lengthUsed(sizes, kerf) <= round1(length)
}

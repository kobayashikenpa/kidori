// 板の使える範囲（耳落とし）と、刃厚込みで入るかの判定
// 板は縦長に置き、左下を原点とする（x：短辺方向、y：長辺方向）
import { round1 } from '../round'
import type { Board, Rect } from '../types'

/**
 * 耳落とし後に使える範囲。耳落としは右側の長辺だけで、その幅は刃厚を含む
 * （サブロク・耳落とし5 なら x 0〜905）
 */
export function usableRect(board: Board, trim: number): Rect {
  return { x: 0, y: 0, w: round1(Math.max(0, board.width - trim)), h: board.length }
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

// 厚みの寸法の判定
import { eq1 } from '../round'
import { AXES, type Axis, type Board, type Part } from '../types'

/**
 * 厚みの寸法を決める。
 * - 手で選んだ軸があればそれ（auto = false）
 * - 枚数0の行・板のない部材は判定しない（null）
 * - それ以外は W→H→D の順に、入力値が板の厚みと同じ（小数第1位で比較）最初の軸
 * inputOf は入力値（逃げを引く前）を返す。計算できない軸は null。必要な軸の分だけ W から順に呼ぶ
 */
export function pickThicknessAxis(
  part: Pick<Part, 'thicknessAxis' | 'quantity'>,
  board: Pick<Board, 'thickness'> | null,
  inputOf: (axis: Axis) => number | null,
): { axis: Axis | null; auto: boolean } {
  if (part.thicknessAxis) return { axis: part.thicknessAxis, auto: false }
  if (part.quantity === 0 || !board) return { axis: null, auto: true }
  for (const axis of AXES) {
    const v = inputOf(axis)
    if (v !== null && eq1(v, board.thickness)) return { axis, auto: true }
  }
  return { axis: null, auto: true }
}

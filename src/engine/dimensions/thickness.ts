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

export interface ThicknessInfo {
  /** 採用した厚みの寸法 */
  thicknessAxis: Axis | null
  /** 自動判定で決めたか */
  thicknessAuto: boolean
  /** 厚みの寸法の値 ≠ 板の厚み（確認を促す） */
  thicknessMismatch: boolean
  /** 板の面になる2軸（W→H→D の順） */
  faceAxes: [Axis, Axis] | null
}

/**
 * 部材の厚みの寸法・不一致の印・板の面になる2軸を決める。
 * input は入力値（逃げを引く前）。計算できない軸は入れない。
 * detectionInput は自動判定に使う値（computeFinished の thicknessInput）。省略すると input で判定する。
 * 自分の軸を参照する部材では、判定に使う値（自分の逃げを引く前）と input が違うことがある
 * 不一致になるのは、板があり枚数が1以上で、次のどちらかのとき
 * - 手で選んだ軸の値が板の厚みと違う
 * - 3軸とも計算できたのに、どの軸も板の厚みと合わない
 */
export function detectThickness(
  part: Pick<Part, 'thicknessAxis' | 'quantity'>,
  board: Pick<Board, 'thickness'> | null,
  input: Partial<Record<Axis, number>>,
  detectionInput: Partial<Record<Axis, number>> = input,
): ThicknessInfo {
  const { axis, auto } = pickThicknessAxis(part, board, (a) => detectionInput[a] ?? null)
  const judged = part.quantity > 0 && board !== null
  let mismatch = false
  if (judged && axis === null) mismatch = AXES.every((a) => detectionInput[a] !== undefined)
  if (judged && axis !== null) {
    const v = input[axis]
    mismatch = v !== undefined && !eq1(v, board.thickness)
  }
  const faces = AXES.filter((a) => a !== axis)
  return {
    thicknessAxis: axis,
    thicknessAuto: auto,
    thicknessMismatch: mismatch,
    faceAxes: axis ? [faces[0], faces[1]] : null,
  }
}

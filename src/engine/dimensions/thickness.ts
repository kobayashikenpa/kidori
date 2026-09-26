// 厚みの寸法の判定
import { eq1, round1 } from '../round'
import { AXES, type Axis, type Board, type DimensionError, type Part } from '../types'

/**
 * 厚みの寸法を決める。
 * - 手で選んだ軸があればそれ（auto = false）
 * - 枚数0の行・板のない部材は判定しない（null）
 * - それ以外は W→H→D の順に、入力値が板の厚みと同じ（小数第1位で比較）最初の軸
 * inputOf は仕上がり寸法を返す。計算できない軸は null。必要な軸の分だけ W から順に呼ぶ
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
  /** 厚みの寸法の値 ≠ 板の厚み（エラー。thicknessMismatchError） */
  thicknessMismatch: boolean
  /** 板の面になる2軸（W→H→D の順） */
  faceAxes: [Axis, Axis] | null
}

/**
 * 部材の厚みの寸法・不一致の印・板の面になる2軸を決める。
 * input は仕上がり寸法。計算できない軸は入れない。
 * 不一致になるのは、板があり枚数が1以上で、次のどちらかのとき
 * - 手で選んだ軸の値が板の厚みと違う
 * - 3軸とも計算できたのに、どの軸も板の厚みと合わない
 */
export function detectThickness(
  part: Pick<Part, 'thicknessAxis' | 'quantity'>,
  board: Pick<Board, 'thickness'> | null,
  input: Partial<Record<Axis, number>>,
): ThicknessInfo {
  const { axis, auto } = pickThicknessAxis(part, board, (a) => input[a] ?? null)
  const judged = part.quantity > 0 && board !== null
  let mismatch = false
  if (judged && axis === null) mismatch = AXES.every((a) => input[a] !== undefined)
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

function mm(v: number): string {
  return String(round1(v))
}

/**
 * 厚みの寸法の不一致のエラー（仕様書 5.3。第1.2版からエラー）。不一致でなければ null。
 * - 手で選んだ軸（または自動で決めた軸）の値が違う：その軸に「厚みの寸法（W=19）が材料の厚み 18 と合いません」
 * - 自動で見つからない：材料の厚みに一番近い値の軸（同じなら W→H→D の順）に付ける
 */
export function thicknessMismatchError(
  partId: string,
  info: ThicknessInfo,
  board: Pick<Board, 'thickness'> | null,
  input: Partial<Record<Axis, number>>,
): DimensionError | null {
  if (!info.thicknessMismatch || !board) return null
  const t = mm(board.thickness)
  if (info.thicknessAxis) {
    const axis = info.thicknessAxis
    return {
      partId,
      axis,
      kind: 'thicknessMismatch',
      message: `厚みの寸法（${axis}=${mm(input[axis] ?? 0)}）が材料の厚み ${t} と合いません`,
    }
  }
  let axis: Axis = 'W'
  for (const a of AXES) {
    if (Math.abs((input[a] ?? Infinity) - board.thickness) < Math.abs((input[axis] ?? Infinity) - board.thickness)) axis = a
  }
  const values = AXES.map((a) => `${a}=${mm(input[a] ?? 0)}`).join('・')
  return {
    partId,
    axis,
    kind: 'thicknessMismatch',
    message: `材料の厚み ${t} と同じ寸法がありません（${values}）。寸法を直すか、厚みの寸法を選んでください`,
  }
}

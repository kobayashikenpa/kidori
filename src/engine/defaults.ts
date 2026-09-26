// 新しい仕事の初期値（逃げ・材料・設定）と、逃げ・材料の厚みの表示名
import { round1 } from './round'
import { BOARD_SIZES, DEFAULT_SETTINGS, type Board, type Nige, type Settings } from './types'

/** 新しい仕事の逃げ：逃げ0.5mm・逃げ1mm。呼ぶたびに新しい配列。id は仕事の中で重複しなければよいので固定 */
export function defaultNige(): Nige[] {
  return [
    { id: 'nige-0.5', value: 0.5 },
    { id: 'nige-1', value: 1 },
  ]
}

/** 新しい仕事の設定：刃厚3・端切り5・切り代10・縦切り優先・逃げ0.5と1。呼ぶたびに新しいオブジェクト */
export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, nige: defaultNige() }
}

/** 新しい仕事の材料：メラミン1・ラワン2.5・ラワン4・ラワン5.5（3×6・木目は長手方向）。id は newId('board') */
export function defaultBoards(newId: (prefix: string) => string): Board[] {
  const [width, length] = BOARD_SIZES.saburoku
  const list: [string, number][] = [
    ['メラミン', 1],
    ['ラワン', 2.5],
    ['ラワン', 4],
    ['ラワン', 5.5],
  ]
  return list.map(([material, thickness]) => ({
    id: newId('board'),
    material,
    thickness,
    sizeKind: 'saburoku',
    width,
    length,
    grain: 'long',
  }))
}

/** 数値を小数第1位までの文字列にする（末尾の .0 は付けない） */
function mm(v: number): string {
  return String(round1(v))
}

/** 逃げの名前（例：逃げ0.5mm、逃げ1mm） */
export function nigeName(value: number): string {
  return `逃げ${mm(value)}mm`
}

/** 式の中の材料の厚みの表示（例：ラワン4mm。間に空白なし） */
export function boardTokenLabel(board: Pick<Board, 'material' | 'thickness'>): string {
  return `${board.material}${mm(board.thickness)}mm`
}

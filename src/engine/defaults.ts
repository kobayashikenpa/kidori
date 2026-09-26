// 新しい仕事の初期値（逃げ・材料・設定）と、逃げ・材料の厚みの表示名
import { round1 } from './round'
import { BOARD_SIZES, DEFAULT_SETTINGS, type Board, type Nige, type Settings } from './types'

/** 新しい仕事の逃げ：逃げ0.5・逃げ1。呼ぶたびに新しい配列。id は仕事の中で重複しなければよいので固定 */
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

/** 新しい仕事の材料：メラミン1・ラワン2.5・ラワン4・ラワン5.5（4×8・木目は長手方向。仕様書 5.1）。id は newId('board') */
export function defaultBoards(newId: (prefix: string) => string): Board[] {
  const [width, length] = BOARD_SIZES.shihachi
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
    sizeKind: 'shihachi',
    width,
    length,
    grain: 'long',
  }))
}

/** 数値を小数第1位までの文字列にする（末尾の .0 は付けない） */
function mm(v: number): string {
  return String(round1(v))
}

/**
 * 逃げの名前（例：逃げ0.5、逃げ1、逃げ0.25。「mm」は付けない。仕様書 4）。
 * 逃げは寸法そのものを式で引くので、名前も丸めない（0.25 を 0.3 と見せない）。浮動小数の誤差（0.1 + 0.2 など）だけ消す
 */
export function nigeName(value: number): string {
  return `逃げ${Number(value.toFixed(6))}`
}

/** 式のボタン・式の中の材料の厚みの表示（例：ラワン4。「mm」は付けず、間に空白なし。仕様書 5.1） */
export function boardTokenLabel(board: Pick<Board, 'material' | 'thickness'>): string {
  return `${board.material}${mm(board.thickness)}`
}

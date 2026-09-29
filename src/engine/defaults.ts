// 新しい仕事の初期値（逃げ・材料・設定）と、逃げ・材料の厚みの表示名
import { exactText, round1 } from './round'
import { BOARD_SIZES, DEFAULT_SETTINGS, type Board, type Nige, type Settings } from './types'

/** 調整寸法の初期の名前。以前の版の逃げ（名前が無い）もこの名前にする */
export const NIGE_DEFAULT_NAME = '逃げ'

/** 新しい仕事の逃げ：逃げ0.5・逃げ1。呼ぶたびに新しい配列。id は仕事の中で重複しなければよいので固定 */
export function defaultNige(): Nige[] {
  return [
    { id: 'nige-0.5', name: NIGE_DEFAULT_NAME, value: 0.5 },
    { id: 'nige-1', name: NIGE_DEFAULT_NAME, value: 1 },
  ]
}

/** 新しい仕事の設定：刃厚3・端切り5・切り代10・縦切り優先・逃げ0.5と1。呼ぶたびに新しいオブジェクト */
export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, nige: defaultNige() }
}

/** 材料のサイズ（大きさの種類・短辺・長辺・木目の方向） */
export type BoardSheet = Pick<Board, 'sizeKind' | 'width' | 'length' | 'grain'>

/**
 * 新しく足す材料のサイズ：4×8（シハチ 1220×2440）・木目は長手方向（仕様書 9「材料のサイズの選択」の初期値）。
 * 呼ぶたびに新しいオブジェクト
 */
export function defaultSheet(): BoardSheet {
  const [width, length] = BOARD_SIZES.shihachi
  return { sizeKind: 'shihachi', width, length, grain: 'long' }
}

/** ラワン・シナの最初から入っている厚み（mm） */
const PLYWOOD_THICKNESSES = [2.5, 3, 4, 5.5, 9, 12, 15, 18, 21, 24, 30]

/**
 * 最初から入っている材料（材料名・厚み）の一覧（第2.5版。仕様書 5.1）：メラミン1、ラワン・シナ 2.5・3・4・5.5・9・12・15・18・21・24・30、
 * ポリ 2.5・4。メラミン1 を先頭に置くのは、以前の版と同じく重ね切りの組が「メラミン1＋ラワン4」の並びになるように
 * （材料の保存の並びで組の a・b を決めるため）。画面では材料名ごとにまとめて並べる
 */
export const DEFAULT_MATERIALS: readonly (readonly [string, number])[] = [
  ['メラミン', 1],
  ...PLYWOOD_THICKNESSES.map((t) => ['ラワン', t] as const),
  ...PLYWOOD_THICKNESSES.map((t) => ['シナ', t] as const),
  ['ポリ', 2.5],
  ['ポリ', 4],
]

/**
 * 第1.1版〜第2.4版の最初から入っている材料（メラミン1・ラワン2.5・4・5.5）。印（builtIn）の無い以前のデータの
 * 並び順の判定だけに使う（boards.ts）
 */
export const LEGACY_DEFAULT_MATERIALS: readonly (readonly [string, number])[] = [
  ['メラミン', 1],
  ['ラワン', 2.5],
  ['ラワン', 4],
  ['ラワン', 5.5],
]

/** 新しい仕事の材料（DEFAULT_MATERIALS。4×8・木目は長手方向。仕様書 5.1）。id は newId('board')。印 builtIn: true を付ける */
export function defaultBoards(newId: (prefix: string) => string): Board[] {
  return DEFAULT_MATERIALS.map(([material, thickness]) => ({
    id: newId('board'),
    material,
    thickness,
    ...defaultSheet(),
    builtIn: true,
  }))
}

/** 数値を小数第1位までの文字列にする（末尾の .0 は付けない） */
function mm(v: number): string {
  return String(round1(v))
}

/**
 * 調整寸法の表示名＝名前＋寸法（例：逃げ0.5、逃げ1、ほぞ15、逃げ0.25。「mm」は付けない。仕様書 4）。
 * 寸法そのものを式で使うので、寸法は丸めない（0.25 を 0.3 と見せない）。浮動小数の誤差（0.1 + 0.2 など）だけ消す
 */
export function nigeName(nige: Pick<Nige, 'name' | 'value'>): string {
  return `${nige.name}${exactText(nige.value)}`
}

/** 調整寸法の名前をそろえる（前後の空白を外し、全角・半角をそろえる）。同じものの判定に使う */
export function nigeNameKey(name: string): string {
  return name.trim().normalize('NFKC')
}

/** 式のボタン・式の中の材料の厚みの表示（例：ラワン4。「mm」は付けず、間に空白なし。仕様書 5.1） */
export function boardTokenLabel(board: Pick<Board, 'material' | 'thickness'>): string {
  return `${board.material}${mm(board.thickness)}`
}

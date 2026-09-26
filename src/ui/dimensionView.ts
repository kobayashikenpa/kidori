// 寸法表の見せ方（カード／表）。この端末だけの好みなので localStorage に置く（読めなくてもカードで動く）
// 表（試作）を外すときは、このファイルと DimensionTable を消し、DimensionScreen の切り替えを外す
export type DimensionView = 'card' | 'table'

const KEY = 'kidori.dimensionView'

export function loadDimensionView(): DimensionView {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'table' ? 'table' : 'card'
  } catch {
    return 'card'
  }
}

export function saveDimensionView(view: DimensionView): void {
  try {
    globalThis.localStorage?.setItem(KEY, view)
  } catch {
    // 保存できなくても、いまの画面では切り替わっている
  }
}

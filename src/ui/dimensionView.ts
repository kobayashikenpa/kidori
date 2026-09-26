// 寸法表の見せ方（カード／表）。この端末だけの好みなので localStorage に置く（読めなくてもカードで動く）
// 寸法表の見せ方（表／カード）の選択を端末に覚える。初期は表
export type DimensionView = 'card' | 'table'

const KEY = 'kidori.dimensionView'

export function loadDimensionView(): DimensionView {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'card' ? 'card' : 'table'
  } catch {
    return 'table'
  }
}

export function saveDimensionView(view: DimensionView): void {
  try {
    globalThis.localStorage?.setItem(KEY, view)
  } catch {
    // 保存できなくても、いまの画面では切り替わっている
  }
}

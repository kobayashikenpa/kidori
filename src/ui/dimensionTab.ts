// 寸法表の画面で最後に開いたタブ（第2.8版。仕様書 9.3）。端末ごとの好みなので localStorage に置く（読めなくても「木取り」で動く）
export type DimensionTab = 'cut' | 'finished'

export const DIMENSION_TABS: readonly { value: DimensionTab; label: string }[] = [
  { value: 'cut', label: '木取り' },
  { value: 'finished', label: '仕上がり' },
]

const KEY = 'kidori.dimensionTab'

export function loadDimensionTab(): DimensionTab {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return DIMENSION_TABS.some((t) => t.value === v) ? (v as DimensionTab) : 'cut'
  } catch {
    return 'cut'
  }
}

export function saveDimensionTab(tab: DimensionTab): void {
  try {
    globalThis.localStorage?.setItem(KEY, tab)
  } catch {
    // 保存できなくても、いまの画面には効いている
  }
}

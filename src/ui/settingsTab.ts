// 設定の画面で最後に開いたタブ（第2.7版）。端末ごとの好みなので localStorage に置く（読めなくても「基本」で動く）
export type SettingsTab = 'basic' | 'materials' | 'groups' | 'adjust'

export const SETTINGS_TABS: readonly { value: SettingsTab; label: string }[] = [
  { value: 'basic', label: '基本' },
  { value: 'materials', label: '材料' },
  { value: 'groups', label: '材料グループ' },
  { value: 'adjust', label: '調整寸法' },
]

const KEY = 'kidori.settingsTab'

export function loadSettingsTab(): SettingsTab {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return SETTINGS_TABS.some((t) => t.value === v) ? (v as SettingsTab) : 'basic'
  } catch {
    return 'basic'
  }
}

export function saveSettingsTab(tab: SettingsTab): void {
  try {
    globalThis.localStorage?.setItem(KEY, tab)
  } catch {
    // 保存できなくても、いまの画面には効いている
  }
}

// 配色（自動／ライト／ダーク）。この端末だけの好みなので localStorage に置く（読めなくても自動で動く）
export type ThemeChoice = 'auto' | 'light' | 'dark'

const KEY = 'kidori.theme'

export function loadTheme(): ThemeChoice {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'auto') delete root.dataset.theme
  else root.dataset.theme = choice
}

export function saveTheme(choice: ThemeChoice): void {
  applyTheme(choice)
  try {
    globalThis.localStorage?.setItem(KEY, choice)
  } catch {
    // 保存できなくても、いまの画面には効いている
  }
}

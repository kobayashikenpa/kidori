// 切り方の選択肢と説明（設定の画面・木取りの画面で共通）
import type { CutMode } from '../engine/types'

export const CUT_MODES: { value: CutMode; label: string }[] = [
  { value: 'vertical', label: '縦切り優先' },
  { value: 'horizontal', label: '横切り優先' },
  { value: 'auto', label: 'おまかせ' },
]

export const CUT_MODE_HINT: Record<CutMode, string> = {
  vertical: '先に長辺方向に帯状に切り、その帯を横に切り分けます。縦長の端材が残りやすい切り方です。',
  horizontal: '先に短辺方向に切り、そのあと縦に切り分けます。',
  auto: '縦切り優先・横切り優先の両方を計算し、必要な板が少ないほうを使います。同じなら、一番大きい端材が大きいほうを使います。',
}

export function cutModeLabel(mode: CutMode): string {
  return CUT_MODES.find((m) => m.value === mode)?.label ?? mode
}

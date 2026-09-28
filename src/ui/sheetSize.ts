// まとめの行のサイズの選択肢（仕様書 4・9、architecture.md 15.9）。
// 材料の行は 3×6・4×8・自由入力（＝手持ち）。重ね切りの組の行は 3×6・4×8 だけ（自由入力・手持ちは使えない）
import type { StandardSize } from '../engine/packing/sizes'
import type { SheetChoice } from '../engine/types'
import type { SizeTarget } from '../store/jobs'

export type SizeOption = StandardSize | 'free'

/** 組の行（2つの材料の id）か */
export const isStackTarget = (target: SizeTarget): target is readonly [string, string] => typeof target !== 'string'

/** その行に出す選択肢（並び順） */
export function sizeChoices(target: SizeTarget): SizeOption[] {
  return isStackTarget(target) ? ['saburoku', 'shihachi'] : ['saburoku', 'shihachi', 'free']
}

/**
 * 選んでいる選択肢。材料の行は、手持ちで木取り中（stockOn）か以前の版の自由入力（大きさだけ）なら自由入力。
 * 組の行は自由入力にしない（保存データに残っていても。自由入力の大きさなら木取りと同じく 4×8）
 */
export function selectedSize(target: SizeTarget, choice: SheetChoice): SizeOption {
  if (isStackTarget(target)) return choice.sizeKind === 'saburoku' ? 'saburoku' : 'shihachi'
  return choice.stockOn === true || choice.sizeKind === 'custom' ? 'free' : choice.sizeKind
}

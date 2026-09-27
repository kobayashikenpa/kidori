// 木取り寸法：仕上がり寸法の、板の面になる2軸それぞれに切り代を足す（厚みの軸はそのまま）
import type { Axis, Part, Settings } from '../types'

export function cutSizeOf(
  finished: Record<Axis, number> | null,
  faceAxes: readonly [Axis, Axis] | null,
  allowance: number,
): Record<Axis, number> | null {
  if (!finished || !faceAxes) return null
  const out = { ...finished }
  for (const a of faceAxes) out[a] += allowance
  return out
}

/**
 * 部材に使う切り代（第2.1版。仕様書 4・7）：部材ごとの上書きがあればそれ。
 * 無ければ、フラッシュの部材（flushId あり）は設定の切り代、フラッシュでない部材は 0
 */
export function partAllowance(part: Pick<Part, 'allowance' | 'flushId'>, settings: Pick<Settings, 'allowance'>): number {
  if (part.allowance !== null) return part.allowance
  return part.flushId !== undefined ? settings.allowance : 0
}

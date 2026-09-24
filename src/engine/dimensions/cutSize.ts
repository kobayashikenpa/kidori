// 木取り寸法：仕上がり寸法の、板の面になる2軸それぞれに切り代を足す（厚みの軸はそのまま）
import type { Axis } from '../types'

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

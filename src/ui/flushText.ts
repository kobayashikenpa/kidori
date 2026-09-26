// フラッシュの厚みの表示（計算は engine の flushBreakdown。ここは文字にするだけ）
import type { FlushBreakdown } from '../engine/flush'
import { fmt } from './format'

/** 「厚み 25（芯材15 ＋ メラミン1×2 ＋ ラワン4×2）」 */
export function flushThicknessText(b: FlushBreakdown): string {
  const words = [`芯材${fmt(b.core)}`, ...b.faces.map((f) => `${f.label}×${f.count}`)]
  return `厚み ${fmt(b.total)}（${words.join(' ＋ ')}）`
}

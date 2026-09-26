// 部材を保存してよいかの確かめ（画面の保存ボタン用）
import type { Job, Part } from '../types'
import { computeDimensions } from './index'

/**
 * 部材を保存できない理由（画面にそのまま出せる日本語）。空なら保存してよい。
 * 仕様書 5.3：厚みの寸法の値が材料の厚みと合わない（自動で見つからないときを含む）部材は保存できない。枚数0の行・材料の無い部材は除く。
 * 式のエラー（存在しない部材の参照など）は保存を止めない（あとから部材を足して直せるため。以前のまま）。
 * part は編集中の部材。仕事の中に同じ id があればその代わりに、無ければ末尾に足して計算する。仕事のデータは変えない
 */
export function validatePartForSave(job: Job, part: Part): string[] {
  const exists = job.parts.some((p) => p.id === part.id)
  const parts = exists ? job.parts.map((p) => (p.id === part.id ? part : p)) : [...job.parts, part]
  const d = computeDimensions({ ...job, parts }).parts.find((p) => p.partId === part.id)
  if (!d) return []
  return d.errors.filter((e) => e.kind === 'thicknessMismatch').map((e) => e.message)
}

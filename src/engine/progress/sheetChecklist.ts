// 1枚ごとのチェックリスト（第1.8版。architecture.md 11.7）：その1枚の片を1行ずつ。
// 並びは layout.placements（右の帯から、帯の中は上から＝切る順番に近い並び）
import type { Job, SheetLayout } from '../types'

export interface SheetChecklistRow {
  pieceId: string
  partId: string
  /** 今の部材名（部材が無ければ写しの名前） */
  name: string
  /** その1枚の写し（固定した1枚）または計算の結果の木取り寸法 */
  sizeLabel: string
  done: boolean
}

export function sheetChecklist(job: Job, layout: SheetLayout, checked: readonly string[]): SheetChecklistRow[] {
  const names = new Map(job.parts.map((p) => [p.id, p.name]))
  const done = new Set(checked)
  return layout.placements.map((p) => ({
    pieceId: p.pieceId,
    partId: p.partId,
    name: names.get(p.partId) ?? p.name,
    sizeLabel: p.sizeLabel,
    done: done.has(p.pieceId),
  }))
}

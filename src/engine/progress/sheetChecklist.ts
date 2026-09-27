// 1枚ごとのチェックリスト（第1.8版。architecture.md 11.7）：その1枚の片を1行ずつ。
// 並びは切る順番に取り出される順（その片を取り出す最後の工程の小さい順。同じなら layout.placements の順）
import type { Job, SheetLayout } from '../types'
import { pieceReleaseSteps } from './sheetProgress'

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
  const steps = pieceReleaseSteps(layout)
  const ordered = layout.placements
    .map((p, i) => ({ p, i, step: steps.get(p.pieceId) ?? 0 }))
    .sort((a, b) => a.step - b.step || a.i - b.i)
    .map(({ p }) => p)
  return ordered.map((p) => ({
    pieceId: p.pieceId,
    partId: p.partId,
    name: names.get(p.partId) ?? p.name,
    sizeLabel: p.sizeLabel,
    done: done.has(p.pieceId),
  }))
}

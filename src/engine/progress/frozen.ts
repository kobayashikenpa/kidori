// 固定した1枚（第1.8版。architecture.md 11.3〜11.5）：画面に出ていた1枚をまるごと写して持つ。
// 写しから描き、写しから進み具合を計算するので、部材や設定が変わっても固定した1枚は動かない
import type { FrozenSheet, Job, SheetLayout } from '../types'

/** frozenDemand のキー */
export function demandKey(partId: string, boardId: string): string {
  return `${partId}|${boardId}`
}

/** 1枚の写し（深いコピー）。元の結果とつながりを持たない */
function copyLayout(layout: SheetLayout): SheetLayout {
  return JSON.parse(JSON.stringify(layout)) as SheetLayout
}

/**
 * 画面に出ている1枚を写して、固定した1枚を作る（チェックは空）。
 * 材料名・厚み・木目は job.boards から、刃厚・端切りは job.settings から写す。材料が無ければ例外
 */
export function freezeSheet(
  job: Job,
  boardId: string,
  mode: 'vertical' | 'horizontal',
  layout: SheetLayout,
  id: string,
  now: Date,
): FrozenSheet {
  const board = job.boards.find((b) => b.id === boardId)
  if (!board) throw new Error(`材料が見つかりません: ${boardId}`)
  return {
    id,
    boardId,
    material: board.material,
    thickness: board.thickness,
    grain: board.grain,
    mode,
    kerf: job.settings.kerf,
    trim: job.settings.trim,
    layout: copyLayout(layout),
    checked: [],
    frozenAt: now.toISOString(),
  }
}

/** 固定した1枚（切り終わりを含む）の片の数。キーは `${partId}|${boardId}`（demandKey） */
export function frozenDemand(job: Pick<Job, 'frozenSheets'>): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of job.frozenSheets) {
    for (const p of s.layout.placements) {
      const k = demandKey(p.partId, s.boardId)
      out.set(k, (out.get(k) ?? 0) + 1)
    }
  }
  return out
}

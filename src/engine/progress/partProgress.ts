// 部材ごとの切り出しの進み具合（第2.7版。architecture.md 19.7）：チェックした片の数から数える
import type { Job, Part } from '../types'

export interface PartCutProgress {
  partId: string
  name: string
  /** 切った片の数（total を超えない） */
  done: number
  /** 切り出す片の数 */
  total: number
}

/** 部材を切り出す材料と片の数（expandPieces と同じ数え方。木取りしない材料・無い材料は数えない） */
function targets(job: Job, part: Part): { boardId: string; count: number; legacyDone: boolean }[] {
  const cutBoards = new Set(job.boards.filter((b) => b.noCut !== true).map((b) => b.id))
  if (part.flushId !== undefined) {
    const flush = job.flushes.find((f) => f.id === part.flushId)
    if (!flush) return []
    return flush.faces
      .filter((f) => cutBoards.has(f.boardId))
      .map((f) => ({ boardId: f.boardId, count: f.count * part.quantity, legacyDone: part.checks.cutByBoard?.[f.boardId] === true }))
  }
  if (part.boardId === null || !cutBoards.has(part.boardId)) return []
  return [{ boardId: part.boardId, count: part.quantity, legacyDone: part.checks.cut }]
}

/** 部材ごとの切り出しの進み具合。並びは job.parts の順。total が 0 の部材は入れない */
export function partCutProgress(job: Job): PartCutProgress[] {
  // 固定した1枚（切り終わりを含む）でチェックした片の数。重ねた板は1片を上下2と数える
  const checked = new Map<string, number>()
  for (const s of job.frozenSheets) {
    const on = new Set(s.checked)
    const per = s.stackWith ? 2 : 1
    for (const p of s.layout.placements) {
      if (on.has(p.pieceId)) checked.set(p.partId, (checked.get(p.partId) ?? 0) + per)
    }
  }
  const out: PartCutProgress[] = []
  for (const part of job.parts) {
    if (!(part.quantity > 0)) continue
    const ts = targets(job, part)
    const total = ts.reduce((n, t) => n + t.count, 0)
    if (total <= 0) continue
    const legacy = ts.reduce((n, t) => n + (t.legacyDone ? t.count : 0), 0)
    const done = Math.min(total, (checked.get(part.id) ?? 0) + legacy)
    out.push({ partId: part.id, name: part.name, done, total })
  }
  return out
}

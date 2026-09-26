// 寸法表のデータ：部材ごとの仕上がり寸法・厚みの寸法・木取り寸法・エラー
import { AXES, type Axis, type DimensionResult, type Job, type PartDimensions } from '../types'
import { cutSizeOf } from './cutSize'
import { computeFinished } from './finished'
import { detectThickness } from './thickness'

export function computeDimensions(job: Job): DimensionResult {
  const fin = computeFinished(job)
  const boardById = new Map(job.boards.map((b) => [b.id, b]))
  const parts: PartDimensions[] = job.parts.map((p) => {
    const f = fin.get(p.id)!
    const board = p.boardId ? (boardById.get(p.boardId) ?? null) : null
    const t = detectThickness(p, board, f.finished)
    const finished = isComplete(f.finished) ? f.finished : null
    const allowance = p.allowance ?? job.settings.allowance
    return {
      partId: p.id,
      name: p.name,
      quantity: p.quantity,
      boardId: p.boardId,
      input: finished,
      finished,
      ...t,
      allowance,
      cutSize: cutSizeOf(finished, t.faceAxes, allowance),
      errors: f.errors,
    }
  })
  return { parts, errors: parts.flatMap((p) => p.errors) }
}

function isComplete(r: Partial<Record<Axis, number>>): r is Record<Axis, number> {
  return AXES.every((a) => r[a] !== undefined)
}

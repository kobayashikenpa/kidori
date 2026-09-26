// 寸法表のデータ：部材ごとの仕上がり寸法・厚みの寸法・木取り寸法・エラー（式のエラーと厚みの不一致）
import { AXES, type Axis, type DimensionResult, type Job, type PartDimensions } from '../types'
import { partThicknessSource } from '../flush'
import { cutSizeOf } from './cutSize'
import { computeFinished } from './finished'
import { detectThickness, thicknessMismatchError } from './thickness'

export function computeDimensions(job: Job): DimensionResult {
  const fin = computeFinished(job)
  const parts: PartDimensions[] = job.parts.map((p) => {
    const f = fin.get(p.id)!
    // 材料の厚み、またはフラッシュの合計の厚み（第1.5版）
    const board = partThicknessSource(job, p)
    const t = detectThickness(p, board, f.finished)
    const finished = isComplete(f.finished) ? f.finished : null
    const allowance = p.allowance ?? job.settings.allowance
    // 厚みの不一致は、その部材だけのエラー（仕上がり寸法は計算できているので、参照しているほかの部材には広げない）
    const mismatch = thicknessMismatchError(p.id, t, board, f.finished)
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
      errors: mismatch ? [...f.errors, mismatch] : f.errors,
    }
  })
  return { parts, errors: parts.flatMap((p) => p.errors) }
}

function isComplete(r: Partial<Record<Axis, number>>): r is Record<Axis, number> {
  return AXES.every((a) => r[a] !== undefined)
}

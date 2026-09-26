// 切り出し（木取り）のチェックリスト（第1.6版。仕様書 9「加工のチェック」）：木取り画面で、材料ごとに切り出す部材と完了を並べる
import { orderedBoards } from './boards'
import { round1 } from './round'
import type { Board, DimensionResult, Job } from './types'

export interface CutChecklistRow {
  /** part：ふつうの部材（完了は checks.cut）／flushFace：フラッシュの部材の表面材（完了は checks.cutByBoard[boardId]） */
  kind: 'part' | 'flushFace'
  partId: string
  partName: string
  /** 切り出す材料（フラッシュなら表面材の材料） */
  boardId: string
  /** 木取り寸法の面の2軸（寸法表・配置図と同じ並び）。寸法のエラーで出せないときは null（完了にした行だけ） */
  size: [number, number] | null
  /** 例："874×410"。size が null なら "－" */
  sizeLabel: string
  /** 切り出す枚数：ふつうの部材は部材の枚数、表面材は 表面材の枚数×部材の枚数 */
  count: number
  done: boolean
}

export interface CutChecklistGroup {
  board: Board
  /** 部材の並び順 */
  rows: CutChecklistRow[]
}

/**
 * 材料ごと（orderedBoards の順）のチェックリスト。行の無い材料は入れない。
 * 出さない行：枚数0の部材、材料（フラッシュ・表面材の材料）が見つからない部材、
 * 寸法のエラー（厚みの不一致を含む）のある部材。ただし完了にした行は、寸法が出せなくても出す（完了を外せるように）
 */
export function cuttingChecklist(job: Job, dims: DimensionResult): CutChecklistGroup[] {
  const boardIds = new Set(job.boards.map((b) => b.id))
  const partById = new Map(job.parts.map((p) => [p.id, p]))
  const rowsByBoard = new Map<string, CutChecklistRow[]>()

  for (const d of dims.parts) {
    const part = partById.get(d.partId)
    if (!part || d.quantity < 1) continue
    const ok = d.errors.length === 0 && d.cutSize !== null && d.faceAxes !== null
    const size: [number, number] | null =
      ok && d.cutSize && d.faceAxes ? [d.cutSize[d.faceAxes[0]], d.cutSize[d.faceAxes[1]]] : null
    const sizeLabel = size ? `${round1(size[0])}×${round1(size[1])}` : '－'

    const targets: Pick<CutChecklistRow, 'kind' | 'boardId' | 'count' | 'done'>[] = []
    if (part.flushId !== undefined) {
      const flush = job.flushes.find((f) => f.id === part.flushId)
      for (const face of flush?.faces ?? []) {
        targets.push({
          kind: 'flushFace',
          boardId: face.boardId,
          count: face.count * d.quantity,
          done: part.checks.cutByBoard?.[face.boardId] === true,
        })
      }
    } else if (part.boardId !== null) {
      targets.push({ kind: 'part', boardId: part.boardId, count: d.quantity, done: part.checks.cut })
    }

    for (const t of targets) {
      if (!boardIds.has(t.boardId) || (!ok && !t.done)) continue
      const rows = rowsByBoard.get(t.boardId) ?? []
      rows.push({ ...t, partId: part.id, partName: d.name, size, sizeLabel })
      rowsByBoard.set(t.boardId, rows)
    }
  }

  return orderedBoards(job).flatMap((board) => {
    const rows = rowsByBoard.get(board.id)
    return rows ? [{ board, rows }] : []
  })
}

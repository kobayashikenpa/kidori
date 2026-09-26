// フラッシュ（第1.5版。仕様書 4）：厚み＝芯材＋表面材の厚み×枚数、厚みの内訳、使っているものの一覧
import { boardTokenLabel } from './defaults'
import { round1 } from './round'
import type { Board, Flush, Job, Part } from './types'

/** 芯材＋Σ 表面材の厚み×枚数。見つからない材料の表面材は数えない */
export function flushThickness(
  flush: Pick<Flush, 'core' | 'faces'>,
  boards: readonly Pick<Board, 'id' | 'thickness'>[],
): number {
  let t = flush.core
  for (const f of flush.faces) {
    const b = boards.find((x) => x.id === f.boardId)
    if (b) t += b.thickness * f.count
  }
  return t
}

/** 式の {t:id} の厚み：材料ならその厚み、フラッシュなら合計の厚み。どちらも無ければ null */
export function thicknessOfId(job: Pick<Job, 'boards' | 'flushes'>, id: string): number | null {
  const board = job.boards.find((b) => b.id === id)
  if (board) return board.thickness
  const flush = job.flushes.find((f) => f.id === id)
  return flush ? flushThickness(flush, job.boards) : null
}

/** 式の {t:id} の表示名：材料は ラワン4、フラッシュは名前（フラッシュ25）。どちらも無ければ null */
export function thicknessRefLabel(job: Pick<Job, 'boards' | 'flushes'>, id: string): string | null {
  const board = job.boards.find((b) => b.id === id)
  if (board) return boardTokenLabel(board)
  return job.flushes.find((f) => f.id === id)?.name ?? null
}

/**
 * 部材の厚みの判定に使う厚み（detectThickness・thicknessChoice に渡す）。
 * フラッシュを選んだ部材はフラッシュの合計の厚み、そうでなければ材料の厚み。どちらも無ければ null
 */
export function partThicknessSource(
  job: Pick<Job, 'boards' | 'flushes'>,
  part: Pick<Part, 'boardId' | 'flushId'>,
): { thickness: number } | null {
  if (part.flushId !== undefined) {
    const flush = job.flushes.find((f) => f.id === part.flushId)
    return flush ? { thickness: flushThickness(flush, job.boards) } : null
  }
  const board = part.boardId === null ? undefined : job.boards.find((b) => b.id === part.boardId)
  return board ? { thickness: board.thickness } : null
}

export interface FlushBreakdown {
  core: number
  /** 表面材（登録順。見つからない材料は入れない） */
  faces: { boardId: string; label: string; thickness: number; count: number }[]
  total: number
}

/** フラッシュの厚みの内訳。無ければ null */
export function flushBreakdown(job: Pick<Job, 'boards' | 'flushes'>, flushId: string): FlushBreakdown | null {
  const flush = job.flushes.find((f) => f.id === flushId)
  if (!flush) return null
  const faces: FlushBreakdown['faces'] = []
  for (const f of flush.faces) {
    const b = job.boards.find((x) => x.id === f.boardId)
    if (b) faces.push({ boardId: b.id, label: boardTokenLabel(b), thickness: b.thickness, count: f.count })
  }
  return { core: flush.core, faces, total: flushThickness(flush, job.boards) }
}

/** 内訳を1行の文字にする（例：芯材15 ＋ メラミン1×2 ＋ ラワン4×2 ＝ 25） */
export function flushBreakdownText(b: FlushBreakdown): string {
  const words = [`芯材${round1(b.core)}`, ...b.faces.map((f) => `${f.label}×${f.count}`)]
  return `${words.join(' ＋ ')} ＝ ${round1(b.total)}`
}

/** 表面材にその材料のどれかを使っているフラッシュの名前（登録順）。材料を削除する前の確認に使う */
export function flushesUsingBoards(job: Pick<Job, 'flushes'>, boardIds: readonly string[]): string[] {
  const ids = new Set(boardIds)
  return job.flushes.filter((f) => f.faces.some((x) => ids.has(x.boardId))).map((f) => f.name)
}

/** 材料の欄でそのフラッシュのどれかを選んでいる部材の名前（部材の並び順）。フラッシュを削除する前の確認に使う */
export function partsUsingFlushes(job: Pick<Job, 'parts'>, flushIds: readonly string[]): string[] {
  const ids = new Set(flushIds)
  return job.parts.filter((p) => p.flushId !== undefined && ids.has(p.flushId)).map((p) => p.name)
}

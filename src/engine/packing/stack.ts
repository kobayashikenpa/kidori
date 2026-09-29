// フラッシュの重ね切り（第2.0版。architecture.md 12.3）：表面材2種類を1枚ずつ重ねて1回で切る。
// 重ねる2つの材料の組を、木取りの上では1つの“材料”（id は stackKey）として扱う
import { boardTokenLabel } from '../defaults'
import type { Board, Flush, Job } from '../types'

/** 木取りする中身（材料があり、木取りしないでない）。中身の並びのまま（第2.5版。flush.ts からも出す） */
export function cutFaces(flush: Pick<Flush, 'faces'>, boards: readonly Pick<Board, 'id' | 'noCut'>[]): Flush['faces'] {
  return flush.faces.filter((f) => {
    const b = boards.find((x) => x.id === f.boardId)
    return b !== undefined && b.noCut !== true
  })
}

/**
 * 重ねて切れる材料グループか：木取りする中身（cutFaces：材料があり木取りしないでない）がちょうど2つ（違う材料）で、
 * 枚数が同じ（第2.5版。木取りしない中身は数えない）
 */
export function canStack(flush: Pick<Flush, 'faces'>, boards: readonly Pick<Board, 'id' | 'noCut'>[]): boolean {
  const f = cutFaces(flush, boards)
  return f.length === 2 && f[0].boardId !== f[1].boardId && f[0].count === f[1].count
}

/** 組の id（組の結果・比較・まとめに使う）。文字列を分解して材料の id を取り出さないこと（boardIds を一緒に持つ） */
export function stackKey(a: string, b: string): string {
  return `stack:${a}+${b}`
}

/** 重ねる組。a・b は材料の保存の並びで前・後ろ */
export interface StackGroup {
  key: string
  boardIds: [string, string]
  /** この組で重ねるフラッシュ（登録順） */
  flushIds: string[]
}

export interface StackPlan {
  groups: StackGroup[]
}

/**
 * どの組を重ねるか。stack がオンで canStack で、表面材の材料が2つとも仕事にあるフラッシュについて組（a, b）を作る。
 * 同じ2つの材料のフラッシュは1つの組にまとめる（未決事項 37）。並びは a の保存の並び → b の保存の並び。
 * 第2.3版（architecture.md 15.4）：組は自分のサイズ（Job.stackSheets）を持つので、材料のサイズ・手持ちは見ない（どの組も重ねる）
 */
export function stackPlan(job: Pick<Job, 'boards' | 'flushes'>): StackPlan {
  const index = new Map(job.boards.map((b, i) => [b.id, i]))
  const pairs = new Map<string, { boardIds: [string, string]; flushIds: string[] }>()
  for (const f of job.flushes) {
    if (f.stack !== true || !canStack(f, job.boards)) continue
    const [x, y] = cutFaces(f, job.boards).map((face) => face.boardId)
    const ix = index.get(x)
    const iy = index.get(y)
    if (ix === undefined || iy === undefined) continue
    const boardIds: [string, string] = ix < iy ? [x, y] : [y, x]
    const key = stackKey(...boardIds)
    const pair = pairs.get(key)
    if (pair) pair.flushIds.push(f.id)
    else pairs.set(key, { boardIds, flushIds: [f.id] })
  }
  const sorted = [...pairs.entries()].sort(
    ([, p], [, q]) =>
      index.get(p.boardIds[0])! - index.get(q.boardIds[0])! || index.get(p.boardIds[1])! - index.get(q.boardIds[1])!,
  )
  return { groups: sorted.map(([key, p]) => ({ key, ...p })) }
}

type Named = Pick<Board, 'material' | 'thickness'>

/**
 * 組の表示名「メラミン1＋ラワン4（重ね切り）」。材料が無ければ fallback（固定した1枚の写しの名前など）、それも無ければ id
 */
export function stackLabel(
  job: Pick<Job, 'boards'>,
  boardIds: readonly [string, string],
  fallback?: readonly [Named, Named],
): string {
  const names = boardIds.map((id, i) => {
    const b = job.boards.find((x) => x.id === id) ?? fallback?.[i]
    return b ? boardTokenLabel(b) : id
  })
  return `${names[0]}＋${names[1]}（重ね切り）`
}

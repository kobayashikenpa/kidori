// 重ね切りの組を作る（第2.6版。仕様書 10.9、architecture.md 18.3）。
// 組は、材料グループの部材の、同じ部材の違う材料の片どうしだけ（同じ材料どうし・材料を直接選んだ部材の片は重ねない）。
// 部材ごとに、残りが一番多い材料と二番目に多い材料から1つずつ取って組にする、を繰り返す（同じ数なら中身の並びで前）。
// 組は2つの材料の対（stackKey）ごとにまとめ、並びは a の保存の並び → b の保存の並び
import type { Job, StackPair } from '../types'
import { orientationsFor, type ExpandResult, type Piece, type PieceRun } from './pieces'
import { stackKey } from './stack'
import { stackChoice } from './stock'

/** a の片に b の片を重ねる（同じ部材・違う材料。配置図には a の片を使う。向きは組の行のサイズで決めたもの） */
export interface PairedPiece {
  a: Piece
  b: Piece
}

/** 組の候補：2つの材料の対と、重ねる片の対（部材の並び） */
export interface PairCandidate extends StackPair {
  pairs: PairedPiece[]
}

/**
 * 組の候補（job.stacking が 'on' のときだけ）。expanded.runs（固定した片・木取り済みを引いた残り）から作る。
 * 組の行のサイズ（stackChoice）に入らない片は組にしない（その材料でふつうに並べる）
 */
export function pairCandidates(job: Job, expanded: Pick<ExpandResult, 'runs'>): PairCandidate[] {
  if (job.stacking !== 'on') return []
  const index = new Map(job.boards.map((b, i) => [b.id, i]))
  const mode = job.settings.cutMode === 'horizontal' ? 'horizontal' : 'vertical'
  const trim = job.settings.trim
  const byKey = new Map<string, PairCandidate>()

  // 部材ごとの材料グループの片の並び（部材の並び）
  const byPart = new Map<string, PieceRun[]>()
  for (const r of expanded.runs) {
    if (r.flushId === undefined || !index.has(r.boardId)) continue
    const list = byPart.get(r.partId)
    if (list) list.push(r)
    else byPart.set(r.partId, [r])
  }

  for (const list of byPart.values()) {
    if (list.length < 2) continue
    const taken = list.map(() => 0)
    const ordered = (x: string, y: string): [string, string] => (index.get(x)! < index.get(y)! ? [x, y] : [y, x])
    /** 組の行のサイズに入る向き（材料の対ごとに1回） */
    const fits = new Map<string, Piece['orientations']>()
    const orientOf = (x: PieceRun, y: PieceRun) => {
      const ids = ordered(x.boardId, y.boardId)
      const key = stackKey(...ids)
      let o = fits.get(key)
      if (!o) {
        o = orientationsFor(x.shape, stackChoice(job, ids), trim, mode)
        fits.set(key, o)
      }
      return o
    }
    const piece = (r: PieceRun, n: number, orientations: Piece['orientations']): Piece => ({
      pieceId: `${r.partId}#${r.start + n}`,
      partId: r.partId,
      name: r.name,
      sizeLabel: r.sizeLabel,
      orientations,
      shape: r.shape,
    })

    for (;;) {
      // 残りの多い順（同じなら中身の並び）
      const order = list
        .map((_, i) => i)
        .filter((i) => list[i].count - taken[i] > 0)
        .sort((i, j) => list[j].count - taken[j] - (list[i].count - taken[i]) || list[i].faceOrder - list[j].faceOrder)
      let pick: [number, number, Piece['orientations']] | null = null
      for (let p = 0; p < order.length && !pick; p++) {
        for (let q = p + 1; q < order.length && !pick; q++) {
          const x = list[order[p]]
          const y = list[order[q]]
          if (x.boardId === y.boardId) continue
          const o = orientOf(x, y)
          if (o.length > 0) pick = [order[p], order[q], o]
        }
      }
      if (!pick) break
      const [i, j, o] = pick
      taken[i]++
      taken[j]++
      const [ia, ib] = index.get(list[i].boardId)! < index.get(list[j].boardId)! ? [i, j] : [j, i]
      const boardIds: [string, string] = [list[ia].boardId, list[ib].boardId]
      const key = stackKey(...boardIds)
      let c = byKey.get(key)
      if (!c) {
        c = { key, boardIds, pairs: [] }
        byKey.set(key, c)
      }
      c.pairs.push({ a: piece(list[ia], taken[ia], o), b: piece(list[ib], taken[ib], o) })
    }
  }

  return [...byKey.values()].sort(
    (p, q) => index.get(p.boardIds[0])! - index.get(q.boardIds[0])! || index.get(p.boardIds[1])! - index.get(q.boardIds[1])!,
  )
}

/**
 * 組にした片を除いた残りの片の並び（runs の並び。残りの無い並びは除く）。組の片は各並びの前から取っている
 */
export function remainingRuns(runs: readonly PieceRun[], candidates: readonly PairCandidate[]): PieceRun[] {
  const used = new Map<string, number>()
  const add = (partId: string, boardId: string) => {
    const k = `${partId}|${boardId}`
    used.set(k, (used.get(k) ?? 0) + 1)
  }
  for (const c of candidates) {
    for (const p of c.pairs) {
      add(p.a.partId, c.boardIds[0])
      add(p.b.partId, c.boardIds[1])
    }
  }
  const out: PieceRun[] = []
  for (const r of runs) {
    const n = used.get(`${r.partId}|${r.boardId}`) ?? 0
    if (n >= r.count) continue
    out.push(n === 0 ? r : { ...r, start: r.start + n, count: r.count - n })
  }
  return out
}

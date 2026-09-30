// 重ねた板の端材を、上下それぞれの材料の手持ちの行にする（第2.6版。仕様書 10.9、architecture.md 18.4 の 4）。
// 端材の行は 1枚・端切りをしない（noTrim）。その仕事の中だけで使う（保存しない）
import { round1 } from '../round'
import type { BoardGrain, FrozenSheet, Job, MaterialResult, SheetLayout } from '../types'
import { MIN_SCRAP } from './scraps'
import { stackKey } from './stack'
import type { StockKind } from './stock'

/** 重ねた板（固定した組の1枚か、計算した組の1枚）と、その番号（「重ねた板1」の 1） */
export interface StackedSheet {
  /** 1 から（組の並び → 組ごとに 固定した1枚（固定した順）→ 計算した1枚） */
  number: number
  /** 固定した1枚は FrozenSheet.id、計算した1枚は `${key}#${layout.index}` */
  id: string
  key: string
  boardIds: [string, string]
  layout: SheetLayout
  /** 板の木目（計算した1枚は組の行の木目＝長手、固定した1枚は写しの木目） */
  grain: BoardGrain
  /** 固定した1枚なら、その写し（切り終わりを含む） */
  frozen?: FrozenSheet
}

/** 計算した重ねた板の id */
export function stackedSheetId(key: string, layout: Pick<SheetLayout, 'index'>): string {
  return `${key}#${layout.index}`
}

/**
 * 重ねた板の番号（architecture.md 18.4 の 4。画面の「重ねた板1」と同じ番号）。
 * 組の並び（a の保存の並び → b の保存の並び。材料が無くなった組は最後に、固定した順）で、
 * 組ごとに 固定した組の1枚（切り終わりを含む。固定した順）→ 計算した組の1枚（materials の stack の結果）
 */
export function stackSheetNumbers(job: Pick<Job, 'boards' | 'frozenSheets'>, materials: readonly MaterialResult[]): StackedSheet[] {
  const index = new Map(job.boards.map((b, i) => [b.id, i]))
  const groups: { key: string; boardIds: [string, string]; first: number; items: Omit<StackedSheet, 'number'>[] }[] = []
  const groupOf = (boardIds: [string, string], first: number) => {
    const key = stackKey(...boardIds)
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, boardIds, first, items: [] }
      groups.push(g)
    }
    return g
  }
  job.frozenSheets.forEach((f, i) => {
    if (!f.stackWith) return
    const g = groupOf([f.boardId, f.stackWith.boardId], i)
    g.items.push({ id: f.id, key: g.key, boardIds: g.boardIds, layout: f.layout, grain: f.grain, frozen: f })
  })
  for (const m of materials) {
    if (!m.stack) continue
    const g = groupOf([m.stack.boardIds[0], m.stack.boardIds[1]], Infinity)
    for (const s of m.sheets) g.items.push({ id: stackedSheetId(g.key, s), key: g.key, boardIds: g.boardIds, layout: s, grain: 'long' })
  }
  const rank = (g: (typeof groups)[number]): [number, number, number] => {
    const a = index.get(g.boardIds[0])
    const b = index.get(g.boardIds[1])
    return a === undefined || b === undefined ? [Infinity, Infinity, g.first] : [a, b, 0]
  }
  const sorted = groups
    .map((g) => ({ g, r: rank(g) }))
    .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.r[2] - y.r[2])
    .map((x) => x.g)
  const out: StackedSheet[] = []
  for (const g of sorted) for (const it of g.items) out.push({ ...it, number: out.length + 1 })
  return out
}

/**
 * 重ねた板の端材を手持ちの行にする（材料ごと。重ねた板の番号の順 → 端材の並び）。1つの端材は a・b に1行ずつ（1枚）。
 * 幅・長さとも MIN_SCRAP（30mm）以上だけ。大きさは 短辺＝min(w, h)・長辺＝max(w, h)。
 * 木目：端材の長辺が板の長手方向（縦長なら h、横長なら w）なら板の木目のまま、そうでなければ逆
 */
export function offcutStock(stacked: readonly StackedSheet[]): Map<string, StockKind[]> {
  const out = new Map<string, StockKind[]>()
  const push = (boardId: string, k: StockKind) => {
    const list = out.get(boardId)
    if (list) list.push({ ...k })
    else out.set(boardId, [{ ...k }])
  }
  for (const s of stacked) {
    const portrait = s.layout.orientation !== 'landscape'
    s.layout.scraps.forEach((r, i) => {
      const w = round1(r.w)
      const h = round1(r.h)
      if (w < MIN_SCRAP || h < MIN_SCRAP) return
      const alongLength = portrait ? h : w
      const alongShort = portrait ? w : h
      const flip: Record<BoardGrain, BoardGrain> = { long: 'short', short: 'long' }
      const grain = alongLength >= alongShort ? s.grain : flip[s.grain]
      const k: StockKind = {
        stockId: `offcut:${s.id}:${i}`,
        sizeKind: 'custom',
        width: Math.min(w, h),
        length: Math.max(w, h),
        grain,
        count: 1,
        noTrim: true,
        offcut: { source: s.number },
      }
      push(s.boardIds[0], k)
      push(s.boardIds[1], k)
    })
  }
  return out
}

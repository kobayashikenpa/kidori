// 木取り計算の入口：材料（板）ごとに、選んだ切り方で並べ、切る順番・端材・歩留まりをまとめる。
// おまかせは縦切り優先・横切り優先の両方を計算し、
// 入らない片が少ないほう → 必要な板が少ないほう → 使った材料の面積の合計が小さいほう（第2.2版。未決事項 41）
// → 同じなら一番大きい端材が大きいほう → それも同じなら縦切り優先 を採る
// （横切り優先は長手も端切りするので、縦切り優先でしか入らない片がありうる）
// 手持ちの材料（第2.2版。architecture.md 14.5）：stockOn の材料は、固定した1枚を引いた手持ち（availableStock）で並べる。
// 1枚ごとにその大きさで端切り・切る順番・端材・歩留まりを出し、sheet を付ける。入らない片は noStock
import { round1 } from '../round'
import type { Board, DimensionResult, Job, MaterialResult, PackingResult, SheetLayout } from '../types'
import { buildCuts } from './cutOrder'
import { packGuillotine, packOnStock, type StripMode } from './guillotine'
import { expandPieces, type Piece, type Unplaced } from './pieces'
import { scrapsOf } from './scraps'
import { stackPlan, type StackPlan } from './stack'
import { sheetOrientation, trimRects, usableRect } from './sheet'
import { availableStock, usesStock, type StockKind } from './stock'
import { combineYield, sheetYield } from './yield'

export { MIN_SCRAP } from './scraps'

interface Layout {
  mode: StripMode
  sheets: SheetLayout[]
  unplaced: Piece[]
}

function layout(pieces: Piece[], board: Board, trim: number, kerf: number, mode: StripMode): Layout {
  const usable = usableRect(board, trim, mode)
  const orientation = sheetOrientation(mode)
  const trims = trimRects(board, trim, mode)
  const g = packGuillotine(pieces, usable, kerf, mode)
  const sheets = g.sheets.map((sh, i): SheetLayout => {
    const placements = sh.strips.flatMap((s) => s.items.map((it) => it.placement))
    const y = sheetYield(placements, board)
    return {
      index: i + 1,
      boardWidth: board.width,
      boardLength: board.length,
      orientation,
      trims,
      usable,
      placements,
      cuts: buildCuts(sh, g.frame, board, trim),
      scraps: scrapsOf(sh, g.frame, kerf),
      usedArea: y.usedArea,
      yieldRate: y.yieldRate,
    }
  })
  return { mode, sheets, unplaced: g.unplaced }
}

/** 手持ちで並べる（1枚ごとにその大きさ）。used は行ごとに使った枚数（stock の並び） */
function stockLayout(pieces: Piece[], stock: StockKind[], trim: number, kerf: number, mode: StripMode): Layout & { used: number[] } {
  const orientation = sheetOrientation(mode)
  const g = packOnStock(pieces, stock, trim, kerf, mode)
  const sheets = g.sheets.map((sh, i): SheetLayout => {
    const size = { width: sh.stock.width, length: sh.stock.length }
    const placements = sh.strips.flatMap((s) => s.items.map((it) => it.placement))
    const y = sheetYield(placements, size)
    const layout: SheetLayout = {
      index: i + 1,
      boardWidth: size.width,
      boardLength: size.length,
      orientation,
      trims: trimRects(size, trim, mode),
      usable: sh.frame.usable,
      placements,
      cuts: buildCuts(sh, sh.frame, size, trim),
      scraps: scrapsOf(sh, sh.frame, kerf),
      usedArea: y.usedArea,
      yieldRate: y.yieldRate,
    }
    if (sh.stock.stockId !== null) layout.sheet = { stockId: sh.stock.stockId, sizeKind: sh.stock.sizeKind, grain: sh.stock.grain }
    return layout
  })
  return { mode, sheets, unplaced: g.unplaced, used: g.used }
}

/** 切り方に従って並べる。おまかせは両方を並べて preferFirst で選ぶ */
function choose<L extends Layout>(cutMode: Job['settings']['cutMode'], run: (mode: StripMode) => L): L {
  if (cutMode !== 'auto') return run(cutMode)
  const v = run('vertical')
  const h = run('horizontal')
  return preferFirst(v, h) ? v : h
}

function areasOf(s: SheetLayout) {
  return { usedArea: s.usedArea, boardArea: s.boardWidth * s.boardLength }
}

/** 使った材料の面積の合計 */
function boardArea(l: Layout): number {
  let sum = 0
  for (const s of l.sheets) sum += s.boardWidth * s.boardLength
  return round1(sum)
}

/** 一番大きい端材の面積（端材がなければ 0） */
function largestScrap(l: Layout): number {
  let max = 0
  for (const s of l.sheets) for (const r of s.scraps) max = Math.max(max, round1(r.w * r.h))
  return max
}

/** おまかせの比べ方：a（縦切り優先）を採るなら true */
function preferFirst(a: Layout, b: Layout): boolean {
  if (a.unplaced.length !== b.unplaced.length) return a.unplaced.length < b.unplaced.length
  if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length
  // 大きさの違う手持ちが混ざるとき（1つの大きさなら枚数が同じなら面積も同じ）
  const aa = boardArea(a)
  const ba = boardArea(b)
  if (aa !== ba) return aa < ba
  return largestScrap(a) >= largestScrap(b)
}

/**
 * 木取りの計算。plan は重ねる組（初期値は今の仕事の stackPlan）。サイズの比較では今の仕事の plan を渡す（12.7）。
 * 組の結果は boardId: stackKey・stack 付き（material・thickness は a）。全体の歩留まりは組の1枚を2枚（a と b）として数える
 */
export function packJob(job: Job, dims: DimensionResult, plan: StackPlan = stackPlan(job)): PackingResult {
  const { kerf, trim, cutMode } = job.settings
  const { groups, skipped, done, stackMismatches } = expandPieces(job, dims, plan)
  const partOrder = new Map(job.parts.map((p, i) => [p.id, i]))

  /** 入らない部材（部材ごとに1つ）。片の理由は reason */
  const unplacedOf = (known: Unplaced[], pieces: Piece[], reason: Unplaced['reason']): Unplaced[] => {
    const all: Unplaced[] = [...known]
    const extra: Unplaced[] = []
    for (const p of pieces) {
      if (!all.some((u) => u.partId === p.partId) && !extra.some((u) => u.partId === p.partId)) {
        extra.push({ partId: p.partId, name: p.name, reason })
      }
    }
    // 手持ちが足りない部材は部材の並びにする（並べた順は大きさの順のため）
    if (reason === 'noStock') extra.sort((a, b) => (partOrder.get(a.partId) ?? 0) - (partOrder.get(b.partId) ?? 0))
    return [...all, ...extra]
  }

  const resultOf = (board: Board, chosen: Layout, unplaced: Unplaced[], stack?: { key: string; boardIds: [string, string] }): MaterialResult => {
    const result: MaterialResult = {
      boardId: stack?.key ?? board.id,
      material: board.material,
      thickness: board.thickness,
      mode: chosen.mode,
      sheets: chosen.sheets,
      sheetCount: chosen.sheets.length,
      yieldRate: combineYield(chosen.sheets.map(areasOf)).yieldRate,
      unplaced,
    }
    if (stack) result.stack = { boardIds: [stack.boardIds[0], stack.boardIds[1]] }
    return result
  }

  const materials = groups.map(({ board, stack, pieces, unplaced }): MaterialResult => {
    if (!stack && usesStock(board)) {
      const stock = availableStock(job, board.id)
      const chosen = choose(cutMode, (mode) => stockLayout(pieces, stock, trim, kerf, mode))
      return resultOf(board, chosen, unplacedOf(unplaced, chosen.unplaced, 'noStock'))
    }
    const chosen = choose(cutMode, (mode) => layout(pieces, board, trim, kerf, mode))
    // 配置で入らなかった片（通常は起きない）も「入らない部材」に加える
    return resultOf(board, chosen, unplacedOf(unplaced, chosen.unplaced, 'tooLarge'), stack)
  })

  const total = combineYield(materials.flatMap((m) => m.sheets.flatMap((s) => (m.stack ? [areasOf(s), areasOf(s)] : [areasOf(s)]))))
  return { materials, totalYieldRate: total.yieldRate, skipped, done, stackMismatches }
}

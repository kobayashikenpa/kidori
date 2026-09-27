// 木取り計算の入口：材料（板）ごとに、選んだ切り方で並べ、切る順番・端材・歩留まりをまとめる。
// おまかせは縦切り優先・横切り優先の両方を計算し、
// 入らない片が少ないほう → 必要な板が少ないほう → 同じなら一番大きい端材が大きいほう → それも同じなら縦切り優先 を採る
// （横切り優先は長手も端切りするので、縦切り優先でしか入らない片がありうる）
import { round1 } from '../round'
import type { Board, DimensionResult, Job, MaterialResult, PackingResult, SheetLayout } from '../types'
import { buildCuts } from './cutOrder'
import { packGuillotine, type StripMode } from './guillotine'
import { expandPieces, type Piece, type Unplaced } from './pieces'
import { scrapsOf } from './scraps'
import { stackPlan, type StackPlan } from './stack'
import { sheetOrientation, trimRects, usableRect } from './sheet'
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

function areasOf(s: SheetLayout) {
  return { usedArea: s.usedArea, boardArea: s.boardWidth * s.boardLength }
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
  return largestScrap(a) >= largestScrap(b)
}

/**
 * 木取りの計算。plan は重ねる組（初期値は今の仕事の stackPlan）。サイズの比較では今の仕事の plan を渡す（12.7）。
 * 組の結果は boardId: stackKey・stack 付き（material・thickness は a）。全体の歩留まりは組の1枚を2枚（a と b）として数える
 */
export function packJob(job: Job, dims: DimensionResult, plan: StackPlan = stackPlan(job)): PackingResult {
  const { kerf, trim, cutMode } = job.settings
  const { groups, skipped, done, stackMismatches } = expandPieces(job, dims, plan)

  const materials = groups.map(({ board, stack, pieces, unplaced }): MaterialResult => {
    let chosen: Layout
    if (cutMode === 'auto') {
      const v = layout(pieces, board, trim, kerf, 'vertical')
      const h = layout(pieces, board, trim, kerf, 'horizontal')
      chosen = preferFirst(v, h) ? v : h
    } else {
      chosen = layout(pieces, board, trim, kerf, cutMode)
    }
    // 配置で入らなかった片（通常は起きない）も「入らない部材」に加える
    const all: Unplaced[] = [...unplaced]
    for (const p of chosen.unplaced) {
      if (!all.some((u) => u.partId === p.partId)) all.push({ partId: p.partId, name: p.name, reason: 'tooLarge' })
    }
    const result: MaterialResult = {
      boardId: stack?.key ?? board.id,
      material: board.material,
      thickness: board.thickness,
      mode: chosen.mode,
      sheets: chosen.sheets,
      sheetCount: chosen.sheets.length,
      yieldRate: combineYield(chosen.sheets.map(areasOf)).yieldRate,
      unplaced: all,
    }
    if (stack) result.stack = { boardIds: [stack.boardIds[0], stack.boardIds[1]] }
    return result
  })

  const total = combineYield(materials.flatMap((m) => m.sheets.flatMap((s) => (m.stack ? [areasOf(s), areasOf(s)] : [areasOf(s)]))))
  return { materials, totalYieldRate: total.yieldRate, skipped, done, stackMismatches }
}

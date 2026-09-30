// 木取り計算の入口：材料（板）ごとに、選んだ切り方で並べ、切る順番・端材・歩留まりをまとめる。
// おまかせは縦切り優先・横切り優先の両方を計算し、
// 入らない片が少ないほう → 必要な板が少ないほう → 使った材料の面積の合計が小さいほう（第2.2版。未決事項 41）
// → 同じなら一番大きい端材が大きいほう → それも同じなら縦切り優先 を採る
// 帯の並べ方（第2.5版。E-69）：材料の行・組の行ごとに、同じ幅を優先する並べ方と今までの並べ方の両方を計算し、
// 入らない片が少ないほう → 板が少ないほう → 同じなら同じ幅を優先するほう を採る
// （横切り優先は長手も端切りするので、縦切り優先でしか入らない片がありうる）
// 手持ちの材料（第2.2版。architecture.md 14.5）：stockOn の材料は、固定した1枚を引いた手持ち（availableStock）で並べる。
// 1枚ごとにその大きさで端切り・切る順番・端材・歩留まりを出し、sheet を付ける。入らない片は noStock
// 重ね切りの組（第2.3版。architecture.md 15.4）：組は組の行のサイズの設定（stackChoice）で並べる。
// 組の手持ちは availableStackStock（材料の手持ちから引かない）。組に置けなかった片は組の noStock（a・b に回さない。未決事項 42）
import { round1 } from '../round'
import type { Board, DimensionResult, Job, MaterialResult, PackingResult, SheetLayout, StackPair } from '../types'
import { buildCuts } from './cutOrder'
import { packGuillotine, packOnStock, rowTrim, type StripMode } from './guillotine'
import { offcutStock, stackSheetNumbers } from './offcuts'
import { pairCandidates, remainingRuns, type PairCandidate } from './pairing'
import { expandPieces, groupRuns, type ExpandResult, type Piece, type Unplaced } from './pieces'
import { scrapsOf } from './scraps'
import { sheetOrientation, trimRects, usableRect } from './sheet'
import { availableStock, sameStockSize, stackChoice, usesStock, type StockKind } from './stock'
import { combineYield, sheetYield } from './yield'

export { MIN_SCRAP } from './scraps'

interface Layout {
  mode: StripMode
  sheets: SheetLayout[]
  unplaced: Piece[]
}

/**
 * 木取りの並べ方の選択（E-68・E-69）。sameWidthFirst を指定しなければ、材料の行・組の行ごとに
 * 同じ幅を優先する並べ方と今までの並べ方の両方を計算して、板が増えないほうを使う（仕様書 8。preferSameWidth）。
 * true は同じ幅を優先する並べ方だけ、false は第2.4版までの並べ方だけで計算する（比べるためだけに使う）
 */
export interface PackOptions {
  sameWidthFirst?: boolean
}

function layout(pieces: Piece[], board: Board, trim: number, kerf: number, mode: StripMode, sameWidthFirst: boolean): Layout {
  const usable = usableRect(board, trim, mode)
  const orientation = sheetOrientation(mode)
  const trims = trimRects(board, trim, mode)
  const g = packGuillotine(pieces, usable, kerf, mode, sameWidthFirst)
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
function stockLayout(
  pieces: Piece[],
  stock: StockKind[],
  trim: number,
  kerf: number,
  mode: StripMode,
  sameWidthFirst: boolean,
): Layout & { used: number[] } {
  const orientation = sheetOrientation(mode)
  const g = packOnStock(pieces, stock, trim, kerf, mode, sameWidthFirst)
  const sheets = g.sheets.map((sh, i): SheetLayout => {
    const size = { width: sh.stock.width, length: sh.stock.length }
    const placements = sh.strips.flatMap((s) => s.items.map((it) => it.placement))
    const y = sheetYield(placements, size)
    // 端切りをしない行（重ねた板の端材。第2.6版）は端切り 0
    const t = rowTrim(sh.stock, trim)
    const layout: SheetLayout = {
      index: i + 1,
      boardWidth: size.width,
      boardLength: size.length,
      orientation,
      trims: trimRects(size, t, mode),
      usable: sh.frame.usable,
      placements,
      cuts: buildCuts(sh, sh.frame, size, t),
      scraps: scrapsOf(sh, sh.frame, kerf),
      usedArea: y.usedArea,
      yieldRate: y.yieldRate,
    }
    if (sh.stock.stockId !== null) {
      layout.sheet = { stockId: sh.stock.stockId, sizeKind: sh.stock.sizeKind, grain: sh.stock.grain }
      if (sh.stock.offcut) layout.sheet.offcut = { source: sh.stock.offcut.source }
    }
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
 * 並べ方の比べ方（E-69。仕様書 8）：同じ幅を優先する並べ方 same を採るなら true。
 * 入らない片が少ないほう → 必要な板が少ないほう → 同じなら同じ幅を優先するほう
 */
function preferSameWidth(same: Layout, old: Layout): boolean {
  if (same.unplaced.length !== old.unplaced.length) return same.unplaced.length < old.unplaced.length
  return same.sheets.length <= old.sheets.length
}

/**
 * 並べ方（同じ幅を優先するか）ごとに切り方で並べる。fixed が無ければ両方を並べて preferSameWidth で選ぶ
 * （おまかせは並べ方ごとに縦切り・横切りを選んでから比べる）
 */
function chooseWay<L extends Layout>(fixed: boolean | undefined, run: (sameWidthFirst: boolean) => L): L {
  if (fixed !== undefined) return run(fixed)
  const same = run(true)
  const old = run(false)
  return preferSameWidth(same, old) ? same : old
}

/** 重ねる組の key の一覧（第2.6版。packJob の plan） */
export type StackPlanFixed = readonly string[]

/** 組の片の向き・配置に使う材料（a に組の行のサイズ（3×6／4×8）をかぶせる。手持ちは使わない） */
function stackBoard(job: Job, a: Board, boardIds: readonly [string, string]): Board {
  const c = stackChoice(job, boardIds)
  const { stockOn: _on, stock: _stock, ...base } = a
  return { ...base, sizeKind: c.sizeKind, width: c.width, length: c.length, grain: c.grain }
}

/** 端材の行から、その材料の固定した端材の1枚の分を引く（大きさ・木目がそろう最初の行から1枚。そろう行が無ければ引かない） */
function subtractFrozenOffcuts(job: Job, boardId: string, rows: readonly StockKind[]): StockKind[] {
  const out = rows.map((r) => ({ ...r }))
  for (const f of job.frozenSheets) {
    if (f.boardId !== boardId || f.stackWith || !f.layout.sheet?.offcut) continue
    const size = { width: f.layout.boardWidth, length: f.layout.boardLength, grain: f.grain }
    const k = out.find((x) => x.count >= 1 && sameStockSize(x, size))
    if (k) k.count -= 1
  }
  return out.filter((r) => r.count >= 1)
}

/** 1つの材料の結果と、比べに使う数（入らない片の数・端材を除いた1枚） */
interface MaterialRun {
  result: MaterialResult
  unplacedPieces: number
}

/**
 * 木取りの計算を組み立てる（第2.6版。architecture.md 18.4）。ex・cands は packJob の中で1回だけ作る。
 * 組の結果（重ねた板）は key ごとに、材料の結果は「その材料の端材の行」ごとに変わるので、呼ぶ側で使い回せるように分けている
 */
class Packer {
  private stackCache = new Map<string, MaterialResult>()
  private readonly partOrder: Map<string, number>

  readonly job: Job
  readonly ex: ExpandResult
  readonly fixedWay: boolean | undefined

  constructor(job: Job, ex: ExpandResult, fixedWay: boolean | undefined) {
    this.job = job
    this.ex = ex
    this.fixedWay = fixedWay
    this.partOrder = new Map(job.parts.map((p, i) => [p.id, i]))
  }

  /** 入らない部材（部材ごとに1つ）。片の理由は reason */
  private unplacedOf(known: Unplaced[], pieces: Piece[], reason: Unplaced['reason']): Unplaced[] {
    const all: Unplaced[] = [...known]
    const extra: Unplaced[] = []
    for (const p of pieces) {
      if (!all.some((u) => u.partId === p.partId) && !extra.some((u) => u.partId === p.partId)) {
        extra.push({ partId: p.partId, name: p.name, reason })
      }
    }
    // 手持ちが足りない部材は部材の並びにする（並べた順は大きさの順のため）
    if (reason === 'noStock') extra.sort((a, b) => (this.partOrder.get(a.partId) ?? 0) - (this.partOrder.get(b.partId) ?? 0))
    return [...all, ...extra]
  }

  /** 組の重ねた板（組の行のサイズで並べる。組の片はどれも組の行に入る向きがある） */
  stack(c: PairCandidate): MaterialResult {
    const hit = this.stackCache.get(c.key)
    if (hit) return hit
    const { kerf, trim, cutMode } = this.job.settings
    const a = this.job.boards.find((b) => b.id === c.boardIds[0])!
    const board = stackBoard(this.job, a, c.boardIds)
    const pieces = c.pairs.map((p) => p.a)
    const chosen = chooseWay(this.fixedWay, (way) => choose(cutMode, (mode) => layout(pieces, board, trim, kerf, mode, way)))
    const result: MaterialResult = {
      boardId: c.key,
      material: a.material,
      thickness: a.thickness,
      mode: chosen.mode,
      sheets: chosen.sheets,
      sheetCount: chosen.sheets.length,
      offcutSheetCount: 0,
      yieldRate: combineYield(chosen.sheets.map(areasOf)).yieldRate,
      unplaced: this.unplacedOf([], chosen.unplaced, 'tooLarge'),
      stack: { boardIds: [c.boardIds[0], c.boardIds[1]] },
    }
    this.stackCache.set(c.key, result)
    return result
  }

  /** 採った組の重ねた板（組の並び） */
  stacks(accepted: readonly PairCandidate[]): MaterialResult[] {
    return accepted.map((c) => this.stack(c))
  }

  /** 端材の行（材料ごと。固定した組の1枚と、採った組の計算した1枚から） */
  offcuts(stackResults: readonly MaterialResult[]): Map<string, StockKind[]> {
    return offcutStock(stackSheetNumbers(this.job, stackResults))
  }

  /**
   * 材料 boardIds のふつうの片（採った組の片を除いた残り）を、材料の手持ち ＋ 端材の行 で並べる。
   * 端材の行が無く、手持ちで木取りしない材料は、今までどおり選んだサイズで並べる
   */
  materials(boardIds: ReadonlySet<string> | null, accepted: readonly PairCandidate[], offcuts: Map<string, StockKind[]>): MaterialRun[] {
    const { kerf, trim, cutMode } = this.job.settings
    const offcutRows = new Map<string, StockKind[]>()
    for (const [id, rows] of offcuts) {
      if (boardIds && !boardIds.has(id)) continue
      const left = subtractFrozenOffcuts(this.job, id, rows)
      if (left.length > 0) offcutRows.set(id, left)
    }
    const runs = remainingRuns(
      boardIds ? this.ex.runs.filter((r) => boardIds.has(r.boardId)) : this.ex.runs,
      accepted.filter((c) => !boardIds || boardIds.has(c.boardIds[0]) || boardIds.has(c.boardIds[1])),
    )
    const out: MaterialRun[] = []
    for (const g of groupRuns(this.job, runs, new Set(offcutRows.keys()))) {
      const { board, pieces, unplaced } = g
      const extra = offcutRows.get(board.id)
      let chosen: Layout
      const reason: Unplaced['reason'] = usesStock(board) ? 'noStock' : 'tooLarge'
      if (usesStock(board) || extra) {
        // 手持ち（固定した1枚を引いた残り）＋ 重ねた板の端材の行（入る一番小さい行から使うので、入れば端材が先）
        const stock = [...availableStock(this.job, board.id), ...(extra ?? [])]
        chosen = chooseWay(this.fixedWay, (way) => choose(cutMode, (mode) => stockLayout(pieces, stock, trim, kerf, mode, way)))
      } else {
        chosen = chooseWay(this.fixedWay, (way) => choose(cutMode, (mode) => layout(pieces, board, trim, kerf, mode, way)))
      }
      const offcutSheets = chosen.sheets.filter((s) => s.sheet?.offcut).length
      const tooLargePieces = runs
        .filter((r) => r.boardId === board.id && unplaced.some((u) => u.partId === r.partId))
        .reduce((n, r) => n + r.count, 0)
      out.push({
        result: {
          boardId: board.id,
          material: board.material,
          thickness: board.thickness,
          mode: chosen.mode,
          sheets: chosen.sheets,
          sheetCount: chosen.sheets.length - offcutSheets,
          offcutSheetCount: offcutSheets,
          yieldRate: combineYield(chosen.sheets.map(areasOf)).yieldRate,
          unplaced: this.unplacedOf(unplaced, chosen.unplaced, reason),
        },
        unplacedPieces: tooLargePieces + chosen.unplaced.length,
      })
    }
    return out
  }
}

/**
 * 木取りの計算（第2.6版。architecture.md 18.4）。
 * 1. 材料ごとの片（expandPieces）→ 2. 組の候補（pairCandidates）のうち plan（重ねる組の key。無ければ候補すべて）の組
 * → 3. 重ねた板を並べる → 4. 重ねた板の端材を a・b の手持ちの行にする → 5. 残りの片を材料の手持ち ＋ 端材の行で並べる。
 * 組の結果は boardId: stackKey・stack 付き（material・thickness は a）。材料の sheetCount は端材の1枚を除いた枚数。
 * 全体の歩留まりは、重ねた板を2枚（a と b）、端材の1枚は板の面積に数えない（重ねた板の中なので）
 */
export function packJob(job: Job, dims: DimensionResult, plan?: StackPlanFixed, options: PackOptions = {}): PackingResult {
  const ex = expandPieces(job, dims)
  const cands = pairCandidates(job, ex)
  const packer = new Packer(job, ex, options.sameWidthFirst)
  const keys = plan === undefined ? null : new Set(plan)
  const accepted = keys ? cands.filter((c) => keys.has(c.key)) : cands
  const rejected = cands.filter((c) => !accepted.includes(c))

  const stackResults = packer.stacks(accepted)
  const plain = packer.materials(null, accepted, packer.offcuts(stackResults)).map((m) => m.result)

  // 並び：材料の保存の並び。組は a の材料の直後（組の並び）
  const materials: MaterialResult[] = []
  for (const b of job.boards) {
    const m = plain.find((x) => x.boardId === b.id)
    if (m) materials.push(m)
    for (const s of stackResults) if (s.stack!.boardIds[0] === b.id) materials.push(s)
  }

  const total = combineYield(
    materials.flatMap((m) =>
      m.sheets.flatMap((s) => {
        if (m.stack) return [areasOf(s), areasOf(s)]
        if (s.sheet?.offcut) return [{ usedArea: s.usedArea, boardArea: 0 }]
        return [areasOf(s)]
      }),
    ),
  )
  const pair = (c: PairCandidate): StackPair => ({ key: c.key, boardIds: [c.boardIds[0], c.boardIds[1]] })
  return {
    materials,
    totalYieldRate: total.yieldRate,
    skipped: ex.skipped,
    done: ex.done,
    stacks: { accepted: accepted.map(pair), rejected: rejected.map(pair) },
  }
}

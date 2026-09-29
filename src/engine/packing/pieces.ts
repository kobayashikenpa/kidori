// 部材を1枚ずつの「片」に展開し、板ごとに分ける。板の木目に部材の木目を合わせて向き（x・y）を決める
import { partIsNoCut } from '../flush'
import { demandKey, frozenDemand } from '../progress/frozen'
import { round1 } from '../round'
import type { Board, BoardGrain, DimensionResult, Job, PackingResult, Part, PartDimensions, UnplacedReason } from '../types'
import { usableSides, type StripMode } from './sheet'
import { stackPlan, type StackGroup, type StackPlan } from './stack'
import { stackChoice, usesStock } from './stock'

/**
 * 板の辺に対する片の向き（置き方＝縦長／横長によらない）。x：短辺（妻手）方向の大きさ、y：長辺（長手）方向の大きさ。
 * 横長に置く横切り優先では、配置図の横が y、縦が x になる（guillotine.ts の frameOf で直す）
 */
export interface Orientation {
  x: number
  y: number
  /** 部材の face[0] を長辺方向に置いたとき false */
  rotated: boolean
}

/** 切り出す片（部材の1枚ぶん） */
export interface Piece {
  /** `${partId}#${連番}` */
  pieceId: string
  partId: string
  name: string
  /** 配置図に出す寸法（面の2軸の順。寸法表と同じ並び） */
  sizeLabel: string
  /**
   * 置いてよい向き（使える範囲に入るものだけ）。「どちらでもよい」なら2つになることがある。
   * おまかせでは広いほう（縦切り優先）の範囲で判定するので、横切り優先で入らない向きが残ることがある（配置で除く）
   */
  orientations: Orientation[]
  /**
   * 面の木取り寸法と木目（第2.2版）。手持ちの大きさ・木目ごとに向きを決め直すのに使う（orientationsFor）。
   * expandPieces が作る片には必ずある
   */
  shape?: PieceShape
}

/** 片の形：面の2軸の木取り寸法（s0：face[0]、s1：face[1]）と、木目を通す軸（0：face[0]、1：face[1]、any：どちらでもよい） */
export interface PieceShape {
  s0: number
  s1: number
  grain: 0 | 1 | 'any'
}

export type Unplaced = { partId: string; name: string; reason: UnplacedReason }

export interface BoardPieces {
  /**
   * 片の向き・配置に使う材料。重ね切りの組では、1つ目の材料 a（id・材料名・厚み）に組の行のサイズの設定
   * （stackChoice の大きさ・木目・手持ち。第2.3版）をかぶせたもの
   */
  board: Board
  /** 重ね切りの組（第2.0版）。あれば、この片たちは a・b を重ねて切る */
  stack?: { key: string; boardIds: [string, string] }
  pieces: Piece[]
  /** どう置いても使える範囲に入らない部材（部材ごとに1つ） */
  unplaced: Unplaced[]
}

export interface ExpandResult {
  /** 板の登録順。片も入らない部材もない板は含めない */
  groups: BoardPieces[]
  /** 計算から除いた部材（枚数0の行は含めない） */
  skipped: PackingResult['skipped']
  /** 木取り済み（checks.cut。フラッシュは表面材ごとの checks.cutByBoard）で除いた部材 */
  done: PackingResult['done']
}

function fmt(v: number): string {
  return String(round1(v))
}

/** 部材を切り出す材料と枚数。ふつうの部材は材料1つ、フラッシュの部材は表面材ごと（枚数＝表面材の枚数×部材の枚数） */
interface Target {
  boardId: string
  quantity: number
  /** 木取り済み（ふつうの部材は checks.cut、フラッシュは checks.cutByBoard[材料]） */
  done: boolean
}

function targetsOf(job: Job, part: Part | undefined, d: PartDimensions): Target[] | null {
  if (part?.flushId !== undefined) {
    const flush = job.flushes.find((f) => f.id === part.flushId)
    if (!flush) return null
    // 木取りしない中身（第2.5版）は片にしない（片の id の連番にも数えない）。材料が見つからない中身は今までどおり残す（noBoard）
    const noCut = new Set(job.boards.filter((b) => b.noCut === true).map((b) => b.id))
    return flush.faces.filter((f) => !noCut.has(f.boardId)).map((f) => ({
      boardId: f.boardId,
      quantity: f.count * d.quantity,
      done: part.checks.cutByBoard?.[f.boardId] === true,
    }))
  }
  return d.boardId === null ? null : [{ boardId: d.boardId, quantity: d.quantity, done: part?.checks.cut === true }]
}

/**
 * 部材を片に展開する。フラッシュの部材（第1.5版）は表面材ごとにその材料の片にする（芯材は入れない）。
 * 片の id の連番は部材ごとの通し番号（表面材をまたいで続ける。固定した片のぶんも番号を取っておく）。
 * 固定した1枚（第1.8版）の片の数は、部材（表面材）の枚数から数だけで引く（寸法は見ない。0 未満にはしない）。
 * 引いて 0 になった部材（表面材）は片にせず、done にも skipped にも入れない。
 * 重ね切り（第2.0版。architecture.md 12.4）：plan の組のフラッシュの部材は、残りの枚数から
 * 重ねる数＝min(a の残り, b の残り) だけ組の“材料”に入れ（片の id は a の番号）、差はそれぞれの材料にふつうに入れる。
 * 組の片の向きは組の行のサイズの設定（stackChoice。第2.3版）で決める
 */
export function expandPieces(job: Job, dims: DimensionResult, plan: StackPlan = stackPlan(job)): ExpandResult {
  const boardById = new Map(job.boards.map((b) => [b.id, b]))
  const partById = new Map(job.parts.map((p) => [p.id, p]))
  const byBoard = new Map<string, BoardPieces>()
  const byStack = new Map<string, BoardPieces>()
  const skipped: ExpandResult['skipped'] = []
  const done: ExpandResult['done'] = []
  const frozen = frozenDemand(job)
  const groupOf = new Map<string, StackGroup>()
  for (const g of plan.groups) for (const f of g.flushIds) groupOf.set(f, g)
  /** 組の片の向き・配置に使う材料（a に組の行のサイズの設定をかぶせる） */
  const stackBoard = (a: Board, boardIds: readonly [string, string]): Board => {
    const c = stackChoice(job, boardIds)
    const { stockOn: _on, stock: _stock, ...base } = a
    const board: Board = { ...base, sizeKind: c.sizeKind, width: c.width, length: c.length, grain: c.grain }
    if (c.stockOn) board.stockOn = true
    if (c.stock) board.stock = c.stock
    return board
  }

  for (const d of dims.parts) {
    if (d.quantity < 1) continue
    const part = partById.get(d.partId)
    // 木取りしない材料だけの部材（第2.5版）：枚数0の行と同じく、片・done・skipped のどれにも入れない
    if (part && partIsNoCut(job, part)) continue
    const targets = targetsOf(job, part, d)
    if (targets === null && part?.flushId === undefined && part?.checks.cut === true) {
      // 材料が未設定でも、木取り済みなら除いた一覧に出す（第1.3版のまま）
      done.push({ partId: d.partId, name: d.name, quantity: d.quantity, boardId: null })
      continue
    }
    // 木取り済みの部材（表面材）は、ほかの判定より先に除く（エラーがあっても直さずに済むように。仕様書 8）
    // start：片の id の連番の始まり。表面材ごとに、固定した片を引く前の枚数ぶん取っておく
    // （ある表面材の固定で、ほかの表面材の片の id がずれないように。以前の木取り済みの表面材は今までどおり取らない）
    const rest: { board: Board; quantity: number; start: number; used: number }[] = []
    let offset = 0
    let missing = false
    /** 以前の木取り済み、または固定した1枚で全部切った表面材の数 */
    let settled = 0
    for (const t of targets ?? []) {
      if (t.done) {
        done.push({ partId: d.partId, name: d.name, quantity: t.quantity, boardId: t.boardId })
        settled++
        continue
      }
      const quantity = Math.max(0, t.quantity - (frozen.get(demandKey(d.partId, t.boardId)) ?? 0))
      const start = offset
      offset += t.quantity
      if (quantity === 0) {
        settled++
        continue
      }
      const board = boardById.get(t.boardId)
      if (board) rest.push({ board, quantity, start, used: 0 })
      else missing = true
    }
    if (targets !== null && targets.length > 0 && settled === targets.length) continue
    if (rest.length === 0 || missing) {
      skipped.push({ partId: d.partId, name: d.name, reason: 'noBoard' })
      continue
    }
    if (d.errors.some((e) => e.kind !== 'thicknessMismatch') || !d.finished) {
      skipped.push({ partId: d.partId, name: d.name, reason: 'dimensionError' })
      continue
    }
    if (d.thicknessMismatch) {
      // 厚みの寸法が材料（フラッシュ）の厚みと合わない（仕様書 5.3。エラー）
      skipped.push({ partId: d.partId, name: d.name, reason: 'thicknessMismatch' })
      continue
    }
    if (!d.cutSize || !d.faceAxes) {
      // 式は正しいが、どの寸法が板の厚みか決まらない（面が決まらない）
      skipped.push({ partId: d.partId, name: d.name, reason: 'noThickness' })
      continue
    }
    const [a0, a1] = d.faceAxes
    const s0 = d.cutSize[a0]
    const s1 = d.cutSize[a1]
    const sizeLabel = `${fmt(s0)}×${fmt(s1)}`
    const partGrain = part?.grain ?? 'any'
    const shape: PieceShape = { s0, s1, grain: partGrain === a0 ? 0 : partGrain === a1 ? 1 : 'any' }
    // stock：手持ちで並べる（第2.2版）。向きは手持ちの行ごとに決め直すので、選んだサイズに入らなくても片にする
    const place = (g: BoardPieces, board: Board, from: number, count: number, stock: boolean) => {
      const orientations = orientationsOn(board, shape, job)
      if (orientations.length === 0 && !stock) {
        if (!g.unplaced.some((u) => u.partId === d.partId)) g.unplaced.push({ partId: d.partId, name: d.name, reason: 'tooLarge' })
        return
      }
      for (let i = 1; i <= count; i++) {
        g.pieces.push({ pieceId: `${d.partId}#${from + i}`, partId: d.partId, name: d.name, sizeLabel, orientations, shape })
      }
    }
    // 重ね切り：a・b の両方に残りがあるぶんだけ組に入れる
    const flushId = part?.flushId
    const stacked = (boardIds: readonly [string, string]) => {
      const ra = rest.find((r) => r.board.id === boardIds[0])
      const rb = rest.find((r) => r.board.id === boardIds[1])
      return ra && rb ? { ra, rb, n: Math.min(ra.quantity, rb.quantity) } : null
    }
    const group = flushId === undefined ? undefined : groupOf.get(flushId)
    const pair = group ? stacked(group.boardIds) : null
    if (group && pair && pair.n > 0) {
      let g = byStack.get(group.key)
      if (!g) {
        g = { board: stackBoard(pair.ra.board, group.boardIds), stack: { key: group.key, boardIds: group.boardIds }, pieces: [], unplaced: [] }
        byStack.set(group.key, g)
      }
      place(g, g.board, pair.ra.start, pair.n, usesStock(g.board))
      pair.ra.used = pair.n
      pair.rb.used = pair.n
    }

    for (const { board, quantity, start, used } of rest) {
      if (quantity - used <= 0) continue
      let g = byBoard.get(board.id)
      if (!g) {
        g = { board, pieces: [], unplaced: [] }
        byBoard.set(board.id, g)
      }
      place(g, board, start + used, quantity - used, usesStock(board))
    }
  }

  // 並び：材料の保存の並び。組は a の材料の直後（plan の並び）
  const groups: BoardPieces[] = []
  for (const b of job.boards) {
    const g = byBoard.get(b.id)
    if (g) groups.push(g)
    for (const sg of plan.groups) {
      const x = sg.boardIds[0] === b.id ? byStack.get(sg.key) : undefined
      if (x) groups.push(x)
    }
  }
  return { groups, skipped, done }
}

/**
 * 大きさ・木目が決まった1枚に置いてよい向き（木目と、使える範囲に入るか）。
 * mode は使える範囲を決める切り方（横切り優先は長手も端切りする）
 */
export function orientationsFor(
  shape: PieceShape,
  sheet: Pick<Board, 'width' | 'length'> & { grain: BoardGrain },
  trim: number,
  mode: StripMode,
): Orientation[] {
  const { s0, s1, grain } = shape
  // face[0] を y に置く向きと、face[1] を y に置く向き
  const upright: Orientation = { x: s1, y: s0, rotated: false }
  const turned: Orientation = { x: s0, y: s1, rotated: true }
  let candidates: Orientation[]
  if (grain !== 'any') {
    // 木目の軸を、板の木目の方向（長辺＝y／短辺＝x）に合わせる
    const grainOnY = sheet.grain === 'long'
    candidates = [(grain === 0) === grainOnY ? upright : turned]
  } else {
    // どちらでもよい（または面にない軸が残っている）→ 回転してよい
    candidates = round1(s0) === round1(s1) ? [upright] : [upright, turned]
  }
  const sides = usableSides(sheet, trim, mode)
  return candidates.filter((o) => round1(o.x) <= round1(sides.short) && round1(o.y) <= round1(sides.long))
}

/** サイズを選んだ材料に置いてよい向き。おまかせは広いほう（縦切り優先）の範囲で判定する */
export function orientationsOn(board: Board, shape: PieceShape, job: Pick<Job, 'settings'>): Orientation[] {
  return orientationsFor(shape, board, job.settings.trim, job.settings.cutMode === 'horizontal' ? 'horizontal' : 'vertical')
}

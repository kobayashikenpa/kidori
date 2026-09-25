// 部材を1枚ずつの「片」に展開し、板ごとに分ける。板の木目に部材の木目を合わせて向き（x・y）を決める
import { round1 } from '../round'
import type { Board, DimensionResult, Job, PackingResult } from '../types'
import { usableSides } from './sheet'

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
}

export type Unplaced = { partId: string; name: string; reason: 'tooLarge' }

export interface BoardPieces {
  board: Board
  pieces: Piece[]
  /** どう置いても使える範囲に入らない部材（部材ごとに1つ） */
  unplaced: Unplaced[]
}

export interface ExpandResult {
  /** 板の登録順。片も入らない部材もない板は含めない */
  groups: BoardPieces[]
  /** 計算から除いた部材（枚数0の行は含めない） */
  skipped: PackingResult['skipped']
}

function fmt(v: number): string {
  return String(round1(v))
}

export function expandPieces(job: Job, dims: DimensionResult): ExpandResult {
  const boardById = new Map(job.boards.map((b) => [b.id, b]))
  const partById = new Map(job.parts.map((p) => [p.id, p]))
  const byBoard = new Map<string, BoardPieces>()
  const skipped: ExpandResult['skipped'] = []

  for (const d of dims.parts) {
    if (d.quantity < 1) continue
    const board = d.boardId ? boardById.get(d.boardId) : undefined
    if (!board) {
      skipped.push({ partId: d.partId, name: d.name, reason: 'noBoard' })
      continue
    }
    if (d.errors.length > 0 || !d.finished) {
      skipped.push({ partId: d.partId, name: d.name, reason: 'dimensionError' })
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
    // face[0] を y に置く向きと、face[1] を y に置く向き
    const upright: Orientation = { x: s1, y: s0, rotated: false }
    const turned: Orientation = { x: s0, y: s1, rotated: true }
    const grain = partById.get(d.partId)?.grain ?? 'any'
    let candidates: Orientation[]
    if (grain === a0 || grain === a1) {
      // 木目の軸を、板の木目の方向（長辺＝y／短辺＝x）に合わせる
      const grainOnY = board.grain === 'long'
      candidates = [(grain === a0) === grainOnY ? upright : turned]
    } else {
      // どちらでもよい（または面にない軸が残っている）→ 回転してよい
      candidates = round1(s0) === round1(s1) ? [upright] : [upright, turned]
    }

    // 横切り優先は長手も端切りする。おまかせは広いほう（縦切り優先）で判定する
    const sides = usableSides(board, job.settings.trim, job.settings.cutMode === 'horizontal' ? 'horizontal' : 'vertical')
    const orientations = candidates.filter((o) => round1(o.x) <= round1(sides.short) && round1(o.y) <= round1(sides.long))

    let g = byBoard.get(board.id)
    if (!g) {
      g = { board, pieces: [], unplaced: [] }
      byBoard.set(board.id, g)
    }
    if (orientations.length === 0) {
      g.unplaced.push({ partId: d.partId, name: d.name, reason: 'tooLarge' })
      continue
    }
    const sizeLabel = `${fmt(s0)}×${fmt(s1)}`
    for (let i = 1; i <= d.quantity; i++) {
      g.pieces.push({ pieceId: `${d.partId}#${i}`, partId: d.partId, name: d.name, sizeLabel, orientations })
    }
  }

  const groups = job.boards.map((b) => byBoard.get(b.id)).filter((g): g is BoardPieces => g !== undefined)
  return { groups, skipped }
}

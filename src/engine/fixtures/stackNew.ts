// 第2.6版（新しい重ね切り）のテスト用の仕事。材料はすべて 3×6（芯材15 だけ木取りしない 4×8）。
// 部材は切り代 0 で書くので、木取り寸法＝式の値（例：H1800・D800 の側板は 1800×800）
import { defaultSettings } from '../defaults'
import { BOARD_SIZES, type Board, type Flush, type Job, type Part } from '../types'

export const MEL = 'b-mel1'
export const L4 = 'b-lauan4'
export const L18 = 'b-lauan18'
export const CORE = 'b-core15'
export const A = 'b-a'
export const B = 'b-b'
export const C = 'b-c'
export const FLUSH25 = 'g-flush25'
export const BETA20 = 'g-beta20'
export const ABC = 'g-abc'

const S36 = { sizeKind: 'saburoku', width: BOARD_SIZES.saburoku[0], length: BOARD_SIZES.saburoku[1], grain: 'long' } as const

export function stackBoards(): Board[] {
  return [
    { id: MEL, material: 'メラミン', thickness: 1, ...S36 },
    { id: L4, material: 'ラワン', thickness: 4, ...S36 },
    { id: L18, material: 'ラワン', thickness: 18, ...S36 },
    { id: A, material: 'シナ', thickness: 2.5, ...S36 },
    { id: B, material: 'シナ', thickness: 4, ...S36 },
    { id: C, material: 'ポリ', thickness: 2.5, ...S36 },
    { id: CORE, material: '芯材', thickness: 15, sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long', noCut: true },
  ]
}

/** フラッシュ25（芯材15×1・メラミン1×2・ラワン4×2）・ベタ20（ラワン18×1・メラミン1×2）・A×1・B×1・C×2（厚み 10） */
export function stackFlushes(): Flush[] {
  return [
    {
      id: FLUSH25,
      name: 'フラッシュ25',
      faces: [
        { boardId: CORE, count: 1 },
        { boardId: MEL, count: 2 },
        { boardId: L4, count: 2 },
      ],
      form: 'flush',
    },
    {
      id: BETA20,
      name: 'ベタ20',
      faces: [
        { boardId: L18, count: 1 },
        { boardId: MEL, count: 2 },
      ],
      form: 'beta',
    },
    {
      id: ABC,
      name: 'グループ10',
      faces: [
        { boardId: A, count: 1 },
        { boardId: B, count: 1 },
        { boardId: C, count: 2 },
      ],
      form: 'empty',
    },
  ]
}

/** 材料グループの部材（W＝厚み、H×D が面。切り代 0） */
export function groupPart(id: string, flushId: string, h: number, d: number, quantity: number, grain: Part['grain'] = 'H'): Part {
  return {
    id,
    name: id,
    boardId: null,
    flushId,
    expr: { W: `{t:${flushId}}`, H: String(h), D: String(d) },
    thicknessAxis: null,
    quantity,
    grain,
    memo: '',
    checks: { finished: false, cut: false },
    allowance: 0,
  }
}

/** 材料を直接選んだ部材（W＝厚み、H×D が面。切り代 0） */
export function boardPart(id: string, boardId: string, h: number, d: number, quantity: number, grain: Part['grain'] = 'H'): Part {
  const thickness = stackBoards().find((b) => b.id === boardId)!.thickness
  return {
    id,
    name: id,
    boardId,
    expr: { W: String(thickness), H: String(h), D: String(d) },
    thicknessAxis: null,
    quantity,
    grain,
    memo: '',
    checks: { finished: false, cut: false },
    allowance: 0,
  }
}

/** 重ね切りオンの仕事（組の行なし） */
export function stackJob(parts: Part[], stacking: Job['stacking'] = 'on'): Job {
  return {
    id: 'job-stack-new',
    name: '重ね切り',
    settings: defaultSettings(),
    boards: stackBoards(),
    flushes: stackFlushes(),
    parts,
    frozenSheets: [],
    stackSheets: [],
    stacking,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

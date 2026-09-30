// 手持ちの材料（第2.2版。architecture.md 14.3）。
// どの材料も「手持ち」で木取りする。サイズを1つ選んだ材料は、そのサイズが無限にある手持ち（1行・枚数 Infinity）とみなす
import { round1 } from '../round'
import { BOARD_SIZES, type BoardGrain, type BoardSizeKind, type FrozenSheet, type Job, type SheetChoice, type StackSheet } from '../types'

/** 材料の手持ちの1行（木取りに使う形） */
export interface StockKind {
  /** 手持ちの行の id。サイズを選んだ材料は null */
  stockId: string | null
  sizeKind: BoardSizeKind
  /** 短辺 */
  width: number
  /** 長辺 */
  length: number
  grain: BoardGrain
  /** 使える枚数。サイズを選んだ材料は Infinity */
  count: number
  /** 端切りをしない行（第2.6版：重ねた板の端材。もう一度の端切りはしない） */
  noTrim?: true
  /** 重ねた板の端材の行なら、どの重ねた板（番号）から出たか（第2.6版） */
  offcut?: { source: number }
}

type SheetSize = Pick<StockKind, 'width' | 'length' | 'grain'>

/** 手持ちで木取りする行（材料の行・組の行）か（stockOn が true で、行が1つ以上） */
export function usesStock(choice: Pick<SheetChoice, 'stockOn' | 'stock'>): boolean {
  return choice.stockOn === true && (choice.stock?.length ?? 0) > 0
}

/** stockOn なら手持ちの行（登録順）、そうでなければ選んだサイズ1行（枚数 Infinity）。材料の行（Board）も組の行（StackSheet）も同じ */
export function stockKinds(choice: SheetChoice): StockKind[] {
  if (usesStock(choice)) {
    return choice.stock!.map((s) => ({
      stockId: s.id,
      sizeKind: s.sizeKind,
      width: s.width,
      length: s.length,
      grain: s.grain,
      count: s.count,
    }))
  }
  return [{ stockId: null, sizeKind: choice.sizeKind, width: choice.width, length: choice.length, grain: choice.grain, count: Infinity }]
}

/** 3×6 → "3×6"、4×8 → "4×8"、自由入力 → "450×900"（短辺×長辺） */
export function stockSizeLabel(s: Pick<StockKind, 'sizeKind' | 'width' | 'length'>): string {
  if (s.sizeKind === 'saburoku') return '3×6'
  if (s.sizeKind === 'shihachi') return '4×8'
  return `${round1(s.width)}×${round1(s.length)}`
}

/** 大きさ（小数第1位）と木目が同じか（選び方 3×6／自由入力 は見ない。未決事項 38 と同じ） */
export function sameStockSize(a: SheetSize, b: SheetSize): boolean {
  return round1(a.width) === round1(b.width) && round1(a.length) === round1(b.length) && a.grain === b.grain
}

/** 組の2つの材料が同じか（並びを問わない） */
export function samePair(x: readonly [string, string], y: readonly [string, string]): boolean {
  return (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0])
}

/** 組の行の設定（第2.3版）。並びを問わずに探す。無ければ undefined */
export function findStackSheet(job: Pick<Job, 'stackSheets'>, boardIds: readonly [string, string]): StackSheet | undefined {
  return (job.stackSheets ?? []).find((s) => samePair(s.boardIds, boardIds))
}

/**
 * 組の行のサイズの設定（第2.3版。architecture.md 15.3・15.9・18.3）。重ね切りの組は 3×6 か 4×8 だけ（仕様書 4。自由入力・手持ちは使わない）。
 * 行の 3×6／4×8 を寸法の決まった値（木目 長手）で返す。行が自由入力なら 4×8。
 * 行が無ければ（第2.6版。未決事項 58 の案 B）：2つの材料の行がどちらもサイズを選んでいて（手持ち・自由入力でない）同じ 3×6／4×8 なら
 * そのサイズ、そうでなければ 4×8。保存データに手持ち（stock・stockOn）が残っていても返さない（木取りは見ない）
 */
export function stackChoice(job: Pick<Job, 'stackSheets' | 'boards'>, boardIds: readonly [string, string]): SheetChoice {
  const s = findStackSheet(job, boardIds)
  let sizeKind: Exclude<BoardSizeKind, 'custom'> = 'shihachi'
  if (s) {
    if (s.sizeKind !== 'custom') sizeKind = s.sizeKind
  } else {
    const kinds = boardIds.map((id) => {
      const b = (job.boards ?? []).find((x) => x.id === id)
      return b && !usesStock(b) && b.sizeKind !== 'custom' ? b.sizeKind : null
    })
    if (kinds[0] !== null && kinds[0] === kinds[1]) sizeKind = kinds[0]
  }
  const [width, length] = BOARD_SIZES[sizeKind]
  return { sizeKind, width, length, grain: 'long' }
}

/** 固定した1枚ごとに、大きさ・木目がそろう最初の行（残り1以上）から1枚引く（そろう行が無ければ引かない） */
function subtractFrozen(kinds: StockKind[], sheets: readonly FrozenSheet[]): StockKind[] {
  for (const f of sheets) {
    const size = { width: f.layout.boardWidth, length: f.layout.boardLength, grain: f.grain }
    const k = kinds.find((x) => x.count >= 1 && sameStockSize(x, size))
    if (k) k.count -= 1
  }
  return kinds
}

/**
 * 固定した1枚（切り終わりを含む。未決事項 40）の分を引いた、材料の手持ち（architecture.md 14.6・15.3）。
 * 引くのはその材料だけの固定した1枚。重ね切りの組の1枚（stackWith あり）は組の手持ちから引くので、ここでは引かない（第2.3版）。
 * 材料が無ければ空
 */
export function availableStock(job: Pick<Job, 'boards' | 'frozenSheets'>, boardId: string): StockKind[] {
  const board = job.boards.find((b) => b.id === boardId)
  if (!board) return []
  return subtractFrozen(
    stockKinds(board),
    // 端材から取った1枚（第2.6版）は端材の行から引く（packJob）ので、ここでは引かない
    job.frozenSheets.filter((f) => f.boardId === boardId && !f.stackWith && !f.layout.sheet?.offcut),
  )
}

/**
 * 固定した組の1枚（boardId と stackWith.boardId が組の2つの材料）の分を引いた、組の手持ち（第2.3版。architecture.md 15.3）。
 * 組は手持ちを使わないので（15.9）、いつも組のサイズ1行（枚数 Infinity）
 */
export function availableStackStock(job: Pick<Job, 'stackSheets' | 'boards' | 'frozenSheets'>, boardIds: readonly [string, string]): StockKind[] {
  return subtractFrozen(
    stockKinds(stackChoice(job, boardIds)),
    job.frozenSheets.filter((f) => f.stackWith && samePair([f.boardId, f.stackWith.boardId], boardIds)),
  )
}

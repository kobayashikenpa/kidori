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

/**
 * 重ね切りの組の手持ち：大きさ・木目がそろう行どうしで、枚数は少ないほう。並びは a の順。
 * 同じ大きさの行がいくつあっても、相手の枚数を二重には使わない（前の行から順に割り当てる）。
 * id は a の行の id（a がサイズを選んだ材料なら b の行の id）。どちらもサイズを選んだ材料なら、そろえば無限の1行。
 * 第2.3版からは組が自分の手持ちを持つので、木取りには使わない（第2.2版までのデータの移し替え＝store/storage.ts だけで使う）
 */
export function commonStock(a: readonly StockKind[], b: readonly StockKind[]): StockKind[] {
  const rest = b.map((k) => k.count)
  const out: StockKind[] = []
  for (const ka of a) {
    let left = ka.count
    while (left > 0) {
      const j = b.findIndex((kb, i) => rest[i] > 0 && sameStockSize(ka, kb))
      if (j < 0) break
      const n = Math.min(left, rest[j])
      const stockId = ka.stockId ?? b[j].stockId
      const last = out[out.length - 1]
      if (last && last.stockId === stockId && last.stockId !== null && sameStockSize(last, ka)) last.count += n
      else out.push({ ...ka, stockId, count: n })
      if (n === Infinity) break
      left -= n
      rest[j] -= n
    }
  }
  return out
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
 * 組の行のサイズの設定（第2.3版。architecture.md 15.3）。行が無ければ 4×8・木目 長手・手持ちなし（仕様書 9「初期値は 4×8」）
 */
export function stackChoice(job: Pick<Job, 'stackSheets'>, boardIds: readonly [string, string]): SheetChoice {
  const s = findStackSheet(job, boardIds)
  if (s) return s
  const [width, length] = BOARD_SIZES.shihachi
  return { sizeKind: 'shihachi', width, length, grain: 'long' }
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
    job.frozenSheets.filter((f) => f.boardId === boardId && !f.stackWith),
  )
}

/**
 * 固定した組の1枚（boardId と stackWith.boardId が組の2つの材料）の分を引いた、組の手持ち（第2.3版。architecture.md 15.3）。
 * 組の行が手持ちでなければ、組のサイズ1行（枚数 Infinity）
 */
export function availableStackStock(job: Pick<Job, 'stackSheets' | 'frozenSheets'>, boardIds: readonly [string, string]): StockKind[] {
  return subtractFrozen(
    stockKinds(stackChoice(job, boardIds)),
    job.frozenSheets.filter((f) => f.stackWith && samePair([f.boardId, f.stackWith.boardId], boardIds)),
  )
}

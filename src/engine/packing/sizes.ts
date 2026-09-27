// 材料のサイズの比較（仕様書 9「材料のサイズの選択」）：材料ごとに 3×6 と 4×8 の両方で木取りし、枚数・歩留まりを並べる
import { BOARD_SIZES, type Board, type DimensionResult, type Job } from '../types'
import { round1 } from '../round'
import { packJob } from './index'
import { stackPlan } from './stack'

export type StandardSize = 'saburoku' | 'shihachi'

export interface SizeSummary {
  kind: StandardSize
  /** 短辺（mm） */
  width: number
  /** 長辺（mm） */
  length: number
  sheetCount: number
  /** その材料の歩留まり */
  yieldRate: number
  /** 入らない部材の数 */
  unplacedCount: number
}

export interface MaterialSizeComparison {
  /** 材料の id。重ね切りの組（第2.0版）は stackKey(a, b) */
  boardId: string
  /** 重ね切りの組なら、組の2つの材料（選んだサイズは2つともに当てる） */
  stack?: { boardIds: [string, string] }
  /** 3×6、4×8 の順 */
  options: [SizeSummary, SizeSummary]
  /** 枚数が少ない方。入らない部材が出るサイズ・枚数 0 のサイズがあれば比べない。同じ枚数なら null */
  fewer: StandardSize | null
  /** 歩留まりが高い方（小数第1位の % で比べる）。比べない条件は fewer と同じ。同じなら null */
  higher: StandardSize | null
}

/** 3×6・4×8 のどちらが枚数が少ないか・歩留まりが高いか（画面の「枚数が少ない」「歩留まりが高い」の印） */
export function pickBetterSize(options: readonly [SizeSummary, SizeSummary]): Pick<MaterialSizeComparison, 'fewer' | 'higher'> {
  const [a, b] = options
  const fits = (o: SizeSummary) => o.unplacedCount === 0 && o.sheetCount > 0
  if (!fits(a) || !fits(b)) return { fewer: null, higher: null }
  const ya = round1(a.yieldRate * 100)
  const yb = round1(b.yieldRate * 100)
  return {
    fewer: a.sheetCount === b.sheetCount ? null : a.sheetCount < b.sheetCount ? a.kind : b.kind,
    higher: ya === yb ? null : ya > yb ? a.kind : b.kind,
  }
}

/**
 * 仕事の「サイズを選ぶ」材料をすべて指定のサイズ（木目は長手方向）にした写し。部材・設定は元の仕事のものを共有する（packJob は書き換えない）。
 * 手持ちで木取りする材料（stockOn）はそのまま残す。サイズを替えると重ね切りの組（手持ちのサイズで決まる）が今の packJob と変わり、
 * 比べる材料の並び・組が画面の結果と合わなくなるため（手持ちの材料の比較は画面では使わない）
 */
function withAllBoards(job: Job, kind: StandardSize): Job {
  const [width, length] = BOARD_SIZES[kind]
  return {
    ...job,
    boards: job.boards.map((b): Board => (b.stockOn ? b : { ...b, sizeKind: kind, width, length, grain: 'long' })),
  }
}

/**
 * 材料ごとに 3×6 と 4×8 で木取りした結果を返す。材料の並びと対象は packJob(job, dims).materials と同じ
 * （片か入らない部材のある材料だけ）。切り方・刃厚・端切り・切り代は今の設定のまま。
 * 材料の数によらず packJob を2回だけ呼ぶ。元の仕事は変えない。手持ちで木取りする材料は手持ちのまま（第2.2版。サイズは替えない）。
 * 重ね切り（第2.0版。architecture.md 12.7）：今の仕事で重ねている組だけを重ねる（今の stackPlan を渡す。
 * すべての材料を同じサイズにすると組は必ずそろうため）。組にも比較が出る（boardId が stackKey）
 */
export function compareStandardSizes(job: Job, dims: DimensionResult): MaterialSizeComparison[] {
  const kinds: StandardSize[] = ['saburoku', 'shihachi']
  const plan = stackPlan(job)
  const results = kinds.map((kind) => ({ kind, materials: packJob(withAllBoards(job, kind), dims, plan).materials }))
  // 対象と並びは、サイズによらず expandPieces で決まる（部材のある材料・板の登録順）ので、3×6 の結果に合わせる
  return results[0].materials.map((m): MaterialSizeComparison => {
    const options = results.map(({ kind, materials }): SizeSummary => {
      const [width, length] = BOARD_SIZES[kind]
      const r = materials.find((x) => x.boardId === m.boardId)
      return {
        kind,
        width,
        length,
        sheetCount: r?.sheetCount ?? 0,
        yieldRate: r?.yieldRate ?? 0,
        unplacedCount: r?.unplaced.length ?? 0,
      }
    })
    const pair: [SizeSummary, SizeSummary] = [options[0], options[1]]
    const c: MaterialSizeComparison = { boardId: m.boardId, options: pair, ...pickBetterSize(pair) }
    if (m.stack) c.stack = { boardIds: [m.stack.boardIds[0], m.stack.boardIds[1]] }
    return c
  })
}

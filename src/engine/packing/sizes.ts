// 材料のサイズの比較（仕様書 9「材料のサイズの選択」）：材料ごとに 3×6 と 4×8 の両方で木取りし、枚数・歩留まりを並べる
import { BOARD_SIZES, type DimensionResult, type Job } from '../types'
import { packJob } from './index'

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
  boardId: string
  /** 3×6、4×8 の順 */
  options: [SizeSummary, SizeSummary]
}

/** 仕事の材料をすべて指定のサイズ（木目は長手方向）にした写し。部材・設定は元の仕事のものを共有する（packJob は書き換えない） */
function withAllBoards(job: Job, kind: StandardSize): Job {
  const [width, length] = BOARD_SIZES[kind]
  return { ...job, boards: job.boards.map((b) => ({ ...b, sizeKind: kind, width, length, grain: 'long' })) }
}

/**
 * 材料ごとに 3×6 と 4×8 で木取りした結果を返す。材料の並びと対象は packJob(job, dims).materials と同じ
 * （片か入らない部材のある材料だけ）。切り方・刃厚・端切り・切り代は今の設定のまま。
 * 材料の数によらず packJob を2回だけ呼ぶ。元の仕事は変えない
 */
export function compareStandardSizes(job: Job, dims: DimensionResult): MaterialSizeComparison[] {
  const kinds: StandardSize[] = ['saburoku', 'shihachi']
  const results = kinds.map((kind) => ({ kind, materials: packJob(withAllBoards(job, kind), dims).materials }))
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
    return { boardId: m.boardId, options: [options[0], options[1]] }
  })
}

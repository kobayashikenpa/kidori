// 共有のファイル（この仕事を送る・ファイルから取り込む。第2.4版。architecture.md 16.4）。React・ブラウザに依存しない
import type { Job } from '../../engine/types'

/** 確認に出す中身：部材の行の数（枚数0の行も数える）と枚数の合計。見本は 5種類・9枚 */
export function shareSummary(job: Pick<Job, 'parts'>): { rows: number; count: number } {
  return { rows: job.parts.length, count: job.parts.reduce((sum, p) => sum + p.quantity, 0) }
}

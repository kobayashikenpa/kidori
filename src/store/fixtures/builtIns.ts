// テスト用：読み込みで自動で足した最初の材料（第2.5.1版）を外して、読み込む前の仕事と比べられるようにする
import type { Board, Job } from '../../engine/types'

/**
 * 元の仕事（original）に無かった「最初から入っている材料」（builtIn）を外した写し。
 * 印の無い以前の仕事で、足すときに付けた印（builtIn）も元に戻す。ほかは変えない
 */
export function dropAddedBuiltIns<T extends Pick<Job, 'boards'>>(job: T, original: Pick<Job, 'boards'>): T {
  const before = new Map(original.boards.map((b) => [b.id, b]))
  const boards: Board[] = []
  for (const b of job.boards) {
    const o = before.get(b.id)
    if (!o) {
      if (b.builtIn !== true) boards.push(b)
      continue
    }
    if (b.builtIn === true && o.builtIn !== true) {
      const { builtIn: _b, ...rest } = b
      boards.push(rest)
    } else boards.push(b)
  }
  return { ...job, boards }
}

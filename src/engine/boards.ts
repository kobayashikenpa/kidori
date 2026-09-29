// 材料の並び順（仕様書 5.1）：あとから追加した材料を追加した順に上から、最初から入っている材料をその下に並べる
import { LEGACY_DEFAULT_MATERIALS } from './defaults'
import { eq1 } from './round'
import type { Board, Job } from './types'

/**
 * 印の無い以前のデータ（第1.1版まで）で、最初からある4つと材料名＋厚みが同じか
 * （サイズ・木目は木取りの画面で変えられるので比べない。第1.3版）。第2.5版で増えた最初の材料は印があるので使わない
 */
function sameAsDefault(b: Board): boolean {
  return LEGACY_DEFAULT_MATERIALS.some(([material, thickness]) => material === b.material.trim() && eq1(thickness, b.thickness))
}

/**
 * 最初から入っている材料か。
 * - `builtIn: true` の印があれば最初からある材料
 * - 仕事の中に印のある材料が1つでもあれば（第1.2版以降に作った仕事）、印の無い材料は足した材料
 * - 印がひとつも無い仕事（第1.1版までに作った仕事）では、最初からある4つと材料名＋厚みが同じ材料を最初からある材料とみなす
 *   （大きさ・木目は比べない。木取りの画面でサイズを選んでも並び順が変わらないように）
 */
export function isBuiltInBoard(board: Board, job: Pick<Job, 'boards'>): boolean {
  if (board.builtIn === true) return true
  if (job.boards.some((b) => b.builtIn === true)) return false
  return sameAsDefault(board)
}

/**
 * 画面に並べる順の材料（新しい配列。元の配列は変えない）。
 * 足した材料（保存の並び＝追加した順）→ 最初から入っている材料（保存の並び）
 */
export function orderedBoards(job: Pick<Job, 'boards'>): Board[] {
  const builtIn = job.boards.filter((b) => isBuiltInBoard(b, job))
  const addedBoards = job.boards.filter((b) => !isBuiltInBoard(b, job))
  return [...addedBoards, ...builtIn]
}

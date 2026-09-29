// 材料の並び順（仕様書 5.1）：あとから追加した材料を追加した順に上から、最初から入っている材料をその下に並べる
import { DEFAULT_MATERIALS, defaultSheet, LEGACY_DEFAULT_MATERIALS } from './defaults'
import { eq1, round1 } from './round'
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

/**
 * 最初から入っている材料を見分けるキー：材料名（前後の空白を外し、全角・半角をそろえる）＋厚み（小数第1位）。
 * Job.removedBuiltIns に入れる（第2.5.1版）
 */
export function builtInKey(material: string, thickness: number): string {
  return `${material.trim().normalize('NFKC')}|${round1(thickness)}`
}

/** 最初から入っている材料（DEFAULT_MATERIALS）のキーか */
export function isDefaultMaterialKey(k: string): boolean {
  return DEFAULT_MATERIALS.some(([m, t]) => builtInKey(m, t) === k)
}

/**
 * 最初から入っている材料（DEFAULT_MATERIALS）のうち、この仕事に無いものを足す（第2.5.1版。仕様書 4「設定の引き継ぎ」）。
 * - 材料名＋厚み（builtInKey）が同じ材料があれば足さない（自分で足した材料・木取りしない材料でも）
 * - removedBuiltIns にある材料（ユーザーが消した最初の材料）は足さない
 * - 足す材料は 4×8・木目は長手方向・印 builtIn。今ある材料・部材・材料グループ・計算結果は変えない
 * - 足す場所は、DEFAULT_MATERIALS の並びで1つ前の最初の材料の後ろ（無ければ最初の材料の先頭、それも無ければ最後）。
 *   今ある材料どうしの前後は変わらない（重ね切りの組の並びなども変わらない）
 * - 印の無い以前の仕事（第1.1版まで）は、最初からある4つとみなしている材料に印を付けてから足す（並び順を変えないため）
 * 足すものが無ければ同じオブジェクトを返す。元の仕事は変えない
 */
export function addMissingBuiltIns(job: Job, newId: (prefix: string) => string): Job {
  const removed = new Set(job.removedBuiltIns ?? [])
  const has = new Set(job.boards.map((b) => builtInKey(b.material, b.thickness)))
  const missing = DEFAULT_MATERIALS.filter(([m, t]) => !has.has(builtInKey(m, t)) && !removed.has(builtInKey(m, t)))
  if (missing.length === 0) return job

  // 印の無い以前の仕事は、最初からある4つとみなしている材料に印を付ける（足す材料の印で、判定が変わらないように）
  const marked = job.boards.some((b) => b.builtIn === true)
  const boards: Board[] = job.boards.map((b) => (!marked && isBuiltInBoard(b, job) ? { ...b, builtIn: true } : b))

  const keyOf = (b: Board) => builtInKey(b.material, b.thickness)
  const missingKeys = new Set(missing.map(([m, t]) => builtInKey(m, t)))
  DEFAULT_MATERIALS.forEach(([material, thickness], i) => {
    if (!missingKeys.has(builtInKey(material, thickness))) return
    const board: Board = { id: newId('board'), material, thickness, ...defaultSheet(), builtIn: true }
    // DEFAULT_MATERIALS の並びで前にある最初の材料（今ある印のある材料）のうち、一番近いものの後ろ
    let at = -1
    for (let j = i - 1; j >= 0 && at < 0; j--) {
      const k = builtInKey(DEFAULT_MATERIALS[j][0], DEFAULT_MATERIALS[j][1])
      at = boards.findIndex((b) => b.builtIn === true && keyOf(b) === k)
    }
    if (at >= 0) boards.splice(at + 1, 0, board)
    else {
      const first = boards.findIndex((b) => b.builtIn === true)
      if (first >= 0) boards.splice(first, 0, board)
      else boards.push(board)
    }
  })
  return { ...job, boards }
}

// 木取りの画面のお知らせ：端切りや切り代を小さくすると材料の枚数が減るときに知らせる（計算は engine の findSavingHints）
// 設定は自動では変えない。知らせるだけ
import { useDeferredValue, useMemo } from 'react'
import { findSavingHints } from '../../engine/hints/saving'
import type { Job } from '../../engine/types'
import { fmt } from '../format'

export function SavingHints({ job }: { job: Job }) {
  // お知らせの計算に使うのは 部材・材料・設定 だけ。どれかが変われば（切り代・端切りの変更を含む）必ず計算し直す
  const { id, name, createdAt, parts, boards, settings } = job
  // 更新日時は操作のたびに変わるが、計算には使わないので、ここでは計算し直しの理由にしない
  const input = useMemo<Job>(
    () => ({ id, name, createdAt, updatedAt: createdAt, parts, boards, settings }),
    [id, name, createdAt, parts, boards, settings],
  )
  // 何回も計算し直すので、木取りの結果を先に出してから後回しで計算する（最初は null）
  const deferred = useDeferredValue<Job | null>(input, null)
  const hints = useMemo(() => (deferred ? findSavingHints(deferred) : []), [deferred])
  // 設定を変えた直後など、まだ前の内容で計算した結果を出しているとき（開いた直後は何も出さずに待つ）
  const pending = deferred !== null && deferred !== input
  // 部材ごとに切り代を入れた部材は、お知らせでもその切り代のまま（設定の切り代を変えても変わらない）
  const own = parts.filter((p) => p.quantity > 0 && p.allowance !== null)

  // 前の結果でお知らせが無かったときは、計算し直しているあいだも枠を出さない（切り方を変えたときに画面がずれないように）
  if (hints.length === 0) return null

  // 前の結果でお知らせがあったときは、計算し直しているあいだも前のお知らせを薄く出したままにする（高さを変えない）
  return (
    <aside className={`card kd-hints${pending ? ' pending' : ''}`} aria-label="材料を減らせるときのお知らせ" aria-busy={pending}>
      <h4>お知らせ：材料を減らせます</h4>
      <ul>
        {hints.map((h) => (
          <li key={`${h.change.kind}-${h.change.value}`}>{h.message}</li>
        ))}
      </ul>
      <p className="band-note">設定は変えていません。変えるときは設定の画面で変えてください。</p>
      {own.length > 0 && (
        <p className="band-note num">
          部材ごとに切り代を入れた部材（{own.map((p) => `${p.name} ${fmt(p.allowance ?? 0)}mm`).join('・')}）は、設定の切り代（{fmt(settings.allowance)}mm）を変えても、その切り代のまま計算します。
        </p>
      )}
    </aside>
  )
}

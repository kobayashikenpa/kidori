// 木取りの画面のお知らせ：端切りや切り代を小さくすると材料の枚数が減るときに知らせる（計算は engine の findSavingHints）
// 設定は自動では変えない。知らせるだけ
import { useDeferredValue, useMemo } from 'react'
import { findSavingHints } from '../../engine/hints/saving'
import type { Job } from '../../engine/types'

export function SavingHints({ job }: { job: Job }) {
  // 計算し直しを何回もするので、木取りの結果を先に出してから後回しで計算する（最初は null）
  const deferred = useDeferredValue<Job | null>(job, null)
  // 仕事（部材・材料・設定）が変わったときだけ計算し直す
  const hints = useMemo(() => (deferred ? findSavingHints(deferred) : []), [deferred])
  if (hints.length === 0) return null

  return (
    <aside className="card kd-hints" aria-label="材料を減らせるときのお知らせ">
      <h4>お知らせ：材料を減らせます</h4>
      <ul>
        {hints.map((h) => (
          <li key={`${h.change.kind}-${h.change.value}`}>{h.message}</li>
        ))}
      </ul>
      <p className="band-note">設定は変えていません。変えるときは設定の画面で変えてください。</p>
    </aside>
  )
}

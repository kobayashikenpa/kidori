// 端材（板ごと）。開け閉めできる。中身は engine の結果（scraps）をそのまま並べる。
// 切る順番（cuts）は第1.6版から画面に出さない（計算は engine に残す）
import { MIN_SCRAP } from '../../engine/packing'
import type { SheetLayout } from '../../engine/types'
import { fmt } from '../format'

export function ScrapList({ sheet }: { sheet: SheetLayout }) {
  return (
    <div className="steps">
      <details className="fold">
        <summary>
          端材<span className="fold-count num">{sheet.scraps.length}枚</span>
        </summary>
        {sheet.scraps.length === 0 ? (
          <p className="band-note">使える大きさ（{MIN_SCRAP}mm 以上）の端材はありません。</p>
        ) : (
          <>
            <p className="band-note">大きい順・横×縦（mm）。{MIN_SCRAP}mm 未満の細い残りは出していません。</p>
            <ul className="scrap-list">
              {sheet.scraps.map((r, i) => (
                <li key={i} className="num">
                  {fmt(r.w)}×{fmt(r.h)}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </div>
  )
}

// 切る順番と端材（板ごと）。どちらも開け閉めできる。中身は engine の結果（cuts・scraps）をそのまま並べる
import { MIN_SCRAP } from '../../engine/packing'
import type { CutStep, SheetLayout } from '../../engine/types'
import { fmt } from '../format'

const KIND_LABEL: Record<CutStep['kind'], string> = {
  trim: '耳落とし',
  strip: '帯を切る',
  crosscut: '切り分け',
  rip: '幅を揃える',
}

export function CutSteps({ sheet }: { sheet: SheetLayout }) {
  return (
    <div className="steps">
      <details className="fold">
        <summary>
          切る順番<span className="fold-count num">{sheet.cuts.length}回</span>
        </summary>
        {sheet.cuts.length === 0 ? (
          <p className="band-note">切る必要はありません。</p>
        ) : (
          <ol className="cut-list">
            {sheet.cuts.map((c) => (
              <li key={c.no} className={`cut-item ${c.kind}`}>
                <span className="cut-no num">{c.no}</span>
                <span className="cut-body">
                  <span className="cut-label">{c.label}</span>
                  <span className="chip">
                    {KIND_LABEL[c.kind]}・{c.direction === 'vertical' ? '縦' : '横'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </details>
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

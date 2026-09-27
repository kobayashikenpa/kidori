// 切る順番（1枚ごと。第1.8版で戻した）。済んだ工程はグレー、次の工程は太字・色つき。
// 中身は engine の結果（layout.cuts）と進み具合（sheetProgress）をそのまま並べる
import type { SheetProgress } from '../../engine/progress/sheetProgress'
import type { CutStep, SheetLayout } from '../../engine/types'

const KIND_LABEL: Record<CutStep['kind'], string> = {
  trim: '端切り',
  strip: '帯を切る',
  crosscut: '切り分け',
  rip: '幅を揃える',
}

export function CutSteps({ sheet, progress }: { sheet: SheetLayout; progress: SheetProgress }) {
  const done = new Set(progress.doneSteps)
  return (
    <details className="fold steps-fold" open>
      <summary>
        切る順番
        <span className="fold-count num">
          {sheet.cuts.length}回{progress.nextStep !== null && done.size > 0 ? `・次は ${progress.nextStep}` : ''}
        </span>
      </summary>
      {sheet.cuts.length === 0 ? (
        <p className="band-note">切る必要はありません。</p>
      ) : (
        <ol className="cut-list">
          {sheet.cuts.map((c) => {
            const state = done.has(c.no) ? ' done' : c.no === progress.nextStep ? ' next' : ''
            return (
              <li key={c.no} className={`cut-item ${c.kind}${state}`} aria-current={state === ' next' ? 'step' : undefined}>
                <span className="cut-no num">{c.no}</span>
                <span className="cut-body">
                  <span className="cut-label">
                    {state === ' next' && <span className="cut-tag">次</span>}
                    {state === ' done' && <span className="cut-tag">済</span>}
                    {c.label}
                  </span>
                  <span className="chip">
                    {KIND_LABEL[c.kind]}・{c.direction === 'vertical' ? '縦' : '横'}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </details>
  )
}

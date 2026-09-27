// 寸法表の表：1部材1行で 部材・枚数・仕上がり寸法 W・H・D・仕上がりの完了 を並べる（仕様書 9「寸法表の表」）。
// 仕上がり寸法の数字を押すと、その下の行に内訳（式の各項と値）を開く。もう一度押すと閉じる。
// 右端の「完了」で仕上がりの完了を付け外しする。完了した行の寸法はグレーにする。
// 木取り寸法と切り出しの完了は寸法表に出さない（木取り画面で見る）。
// フラッシュの部材は、厚みの内訳を下の行に1行で出す。
import { Fragment, useMemo, useState } from 'react'
import { explainDimension, explanationText } from '../../engine/dimensions/explain'
import { computeFinished } from '../../engine/dimensions/finished'
import { flushBreakdown, flushBreakdownText } from '../../engine/flush'
import { AXES, type Axis, type Job, type PartChecks, type PartDimensions } from '../../engine/types'
import { fmt } from '../format'

interface Props {
  job: Job
  /** computeDimensions(job).parts（部材の並び順） */
  dims: readonly PartDimensions[]
  /** 部材の仕上がりの完了を変える（setPartChecks） */
  onCheck: (partId: string, patch: Partial<PartChecks>) => void
}

export function DimensionTable({ job, dims, onCheck }: Props) {
  const finished = useMemo(() => computeFinished(job), [job])
  // 開いている内訳（1つだけ）
  const [open, setOpen] = useState<{ partId: string; axis: Axis } | null>(null)

  return (
    <div className="dim-table-wrap">
      <table className="dim-table">
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="c-name">
              部材
            </th>
            <th scope="col" rowSpan={2} className="c-qty">
              枚数
            </th>
            <th scope="colgroup" colSpan={4} className="c-fin c-group">
              仕上がり寸法
            </th>
          </tr>
          <tr>
            {AXES.map((a) => (
              <th key={a} scope="col" className="c-fin">
                {a}
              </th>
            ))}
            <th scope="col" className="c-fin c-done">
              完了
            </th>
          </tr>
        </thead>
        <tbody>
          {job.parts.map((p, i) => {
            const d = dims[i]
            const cutting = p.quantity > 0
            const finDone = cutting && p.checks.finished
            const flush = p.flushId !== undefined ? flushBreakdown(job, p.flushId) : null
            const mismatch = d.errors.some((e) => e.kind === 'thicknessMismatch')
            const ex = AXES.map((a) => explainDimension(job, p.id, a, finished))
            const openAxis = open?.partId === p.id ? open.axis : null
            const openEx = openAxis ? ex[AXES.indexOf(openAxis)] : null
            return (
              <Fragment key={p.id}>
                <tr className={`${openAxis ? 'row-open' : ''}${finDone ? ' row-done' : ''}`.trim() || undefined}>
                  <th scope="row" className="c-name">
                    {p.name}
                    {mismatch && <span className="dim-note bad"> 厚みが合わない</span>}
                  </th>
                  <td className="c-qty num">{cutting ? p.quantity : '0'}</td>
                  {AXES.map((a, k) => {
                    const e = ex[k]
                    const bad = !e || e.result === null || e.errors.length > 0
                    const on = openAxis === a
                    return (
                      <td key={a} className={`c-fin${finDone ? ' done' : ''}`}>
                        <button
                          type="button"
                          className={`dim-cell num${bad ? ' bad' : ''}${d.thicknessAxis === a ? ' thick' : ''}${on ? ' on' : ''}`}
                          aria-expanded={on}
                          aria-label={`${p.name} の ${a} の内訳`}
                          onClick={() => setOpen(on ? null : { partId: p.id, axis: a })}
                        >
                          {e && e.result !== null ? fmt(e.result) : 'エラー'}
                        </button>
                      </td>
                    )
                  })}
                  <td className={`c-done${finDone ? ' done' : ''}`}>
                    {cutting ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={finDone}
                        aria-label={`${p.name} の仕上がり 完了`}
                        className="dim-check"
                        onClick={() => onCheck(p.id, { finished: !finDone })}
                      >
                        <span className="check-box" aria-hidden="true">
                          {finDone ? '✓' : ''}
                        </span>
                      </button>
                    ) : (
                      <span className="dim-note">―</span>
                    )}
                  </td>
                </tr>
                {flush && (
                  <tr className="dim-flush">
                    <td colSpan={6}>
                      <span className="dim-flush-head num">
                        {p.name}：厚み {flushBreakdownText(flush)}
                      </span>
                    </td>
                  </tr>
                )}
                {openAxis && (
                  <tr className="dim-explain">
                    <td colSpan={6}>
                      <span className="dim-explain-head">
                        {p.name}.{openAxis} の内訳
                      </span>
                      {openEx && openEx.pieces.length > 0 && (
                        <span className="dim-explain-text num">{explanationText(openEx)}</span>
                      )}
                      {openEx?.errors.map((e, k) => (
                        <span key={k} className="dim-explain-err">
                          {e.message}
                        </span>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

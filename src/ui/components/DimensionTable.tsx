// 寸法表の「表」の見せ方（試作）：1部材1行で 部材・枚数・仕上がり寸法 W・H・D・木取り寸法 を並べる。
// 仕上がり寸法の数字を押すと、その下の行に内訳（式の各項と値）を開く。もう一度押すと閉じる。
// 完了のチェックはカードで付ける（表では、完了した寸法をグレーで見せるだけ）。
// 外すときは、このファイルと ../dimensionView.ts、index.css の「寸法表の表」の段を消し、DimensionScreen の切り替えを外す
import { Fragment, useMemo, useState } from 'react'
import { explainDimension, explanationText } from '../../engine/dimensions/explain'
import { computeFinished } from '../../engine/dimensions/finished'
import { flushBreakdown } from '../../engine/flush'
import { AXES, type Axis, type Job, type PartDimensions } from '../../engine/types'
import { flushThicknessText } from '../flushText'
import { fmt } from '../format'

interface Props {
  job: Job
  /** computeDimensions(job).parts（部材の並び順） */
  dims: readonly PartDimensions[]
  /** フラッシュの部材の、表面材ごとの木取りの完了を変える（setFlushCutCheck） */
  onFlushCheck: (partId: string, boardId: string, done: boolean) => void
}

export function DimensionTable({ job, dims, onFlushCheck }: Props) {
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
            <th scope="colgroup" colSpan={3} className="c-fin c-group">
              ① 仕上がり
            </th>
            <th scope="col" rowSpan={2} className="c-cut">
              ② 木取り
            </th>
          </tr>
          <tr>
            {AXES.map((a) => (
              <th key={a} scope="col" className="c-fin">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {job.parts.map((p, i) => {
            const d = dims[i]
            const cutting = p.quantity > 0
            const finDone = cutting && p.checks.finished
            // フラッシュの部材：厚みの内訳と、表面材ごとの完了（全部の表面材が完了なら木取り寸法もグレー）
            const flush = p.flushId !== undefined ? flushBreakdown(job, p.flushId) : null
            const faceDone = (boardId: string) => p.checks.cutByBoard?.[boardId] === true
            const cutDone =
              cutting && (flush ? flush.faces.length > 0 && flush.faces.every((f) => faceDone(f.boardId)) : p.checks.cut)
            const mismatch = d.errors.some((e) => e.kind === 'thicknessMismatch')
            const ex = AXES.map((a) => explainDimension(job, p.id, a, finished))
            const openAxis = open?.partId === p.id ? open.axis : null
            const openEx = openAxis ? ex[AXES.indexOf(openAxis)] : null
            return (
              <Fragment key={p.id}>
                <tr className={openAxis ? 'row-open' : undefined}>
                  <th scope="row" className="c-name">
                    {p.name}
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
                  <td className={`c-cut num${cutDone ? ' done' : ''}`}>
                    {!cutting ? (
                      <span className="dim-note">寸法だけ</span>
                    ) : mismatch ? (
                      <span className="dim-note bad">厚みが合わない</span>
                    ) : d.cutSize && d.faceAxes ? (
                      <>
                        {fmt(d.cutSize[d.faceAxes[0]])}
                        <span className="x">×</span>
                        {fmt(d.cutSize[d.faceAxes[1]])}
                      </>
                    ) : (
                      '―'
                    )}
                  </td>
                </tr>
                {flush && (
                  <tr className="dim-flush">
                    <td colSpan={6}>
                      <span className="dim-flush-head num">
                        {p.name}：{flushThicknessText(flush)}
                      </span>
                      {cutting &&
                        flush.faces.map((f) => {
                          const on = faceDone(f.boardId)
                          return (
                            <button
                              key={f.boardId}
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`${p.name} の ${f.label} ${f.count * p.quantity}枚 の切り出し 完了`}
                              className={`dim-face${on ? ' done' : ''}`}
                              onClick={() => onFlushCheck(p.id, f.boardId, !on)}
                            >
                              <span className="dim-face-name">{f.label}</span>
                              <span className="num">×{f.count * p.quantity}枚</span>
                              <span className="dim-face-check">
                                <span className="check-box" aria-hidden="true">
                                  {on ? '✓' : ''}
                                </span>
                                完了
                              </span>
                            </button>
                          )
                        })}
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

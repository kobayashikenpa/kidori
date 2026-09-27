// 寸法表の表：1部材1行で 部材・枚数・仕上がり寸法 W・H・D・仕上がりの完了 を並べる（仕様書 9「寸法表の表」）。
// 仕上がり寸法の数字を押すと、その下の行に内訳（式の各項と値）を開く。もう一度押すと閉じる。
// 部材のメモは部材名の下に小さく出す。長いときは1行で省略し、部材名のところを押すと全文を出す（もう一度押すと戻す）。
// 右端の「完了」で仕上がりの完了を付け外しする。完了した行の寸法はグレーにする。
// 木取り寸法と切り出しの完了は寸法表に出さない（木取り画面で見る）。
// フラッシュの部材は、厚みの数字を押したときの内訳に フラッシュ25（芯材15 ＋ メラミン1×2 ＋ ラワン4×2） を出す。
import { Fragment, useMemo, useState } from 'react'
import { explainDimension, explanationText } from '../../engine/dimensions/explain'
import { computeFinished } from '../../engine/dimensions/finished'
import { flushBreakdown, flushCompositionText } from '../../engine/flush'
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
  // メモを全文で出している部材
  const [memoOpen, setMemoOpen] = useState<ReadonlySet<string>>(new Set())
  const toggleMemo = (id: string) =>
    setMemoOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
            const flushName = p.flushId !== undefined ? job.flushes.find((f) => f.id === p.flushId)?.name : undefined
            const flush = p.flushId !== undefined && flushName !== undefined ? flushBreakdown(job, p.flushId) : null
            const mismatch = d.errors.some((e) => e.kind === 'thicknessMismatch')
            const ex = AXES.map((a) => explainDimension(job, p.id, a, finished))
            const memo = p.memo.trim()
            const memoFull = memoOpen.has(p.id)
            const openAxis = open?.partId === p.id ? open.axis : null
            const openEx = openAxis ? ex[AXES.indexOf(openAxis)] : null
            // フラッシュの部材の厚みを開いたとき：フラッシュの中身を出す。式がフラッシュの厚み1つだけなら式の内訳は省く
            const flushText = flush && flushName !== undefined && openAxis !== null && openAxis === d.thicknessAxis ? flushCompositionText(flushName, flush) : null
            const onlyFlush =
              flushText !== null &&
              openEx?.pieces.length === 1 &&
              openEx.pieces[0].kind === 'ref' &&
              openEx.pieces[0].ref === 'thickness' &&
              openEx.pieces[0].label === flushName
            return (
              <Fragment key={p.id}>
                <tr className={`${openAxis ? 'row-open' : ''}${finDone ? ' row-done' : ''}`.trim() || undefined}>
                  <th scope="row" className="c-name">
                    {memo === '' ? (
                      <span className="dim-name">
                        {p.name}
                        {mismatch && <span className="dim-note bad">厚みが合わない</span>}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="dim-name"
                        aria-expanded={memoFull}
                        aria-label={`${p.name}（メモ：${memo}）${memoFull ? '' : ' メモを全文で表示'}`}
                        onClick={() => toggleMemo(p.id)}
                      >
                        {p.name}
                        {mismatch && <span className="dim-note bad">厚みが合わない</span>}
                        <span className={`dim-memo${memoFull ? ' full' : ''}`}>{memo}</span>
                      </button>
                    )}
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
                {openAxis && (
                  <tr className="dim-explain">
                    <td colSpan={6}>
                      <span className="dim-explain-head">
                        {p.name}.{openAxis} の内訳
                      </span>
                      {openEx && openEx.pieces.length > 0 && !onlyFlush && (
                        <span className="dim-explain-text num">{explanationText(openEx)}</span>
                      )}
                      {flushText !== null && <span className="dim-explain-text num">{flushText}</span>}
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

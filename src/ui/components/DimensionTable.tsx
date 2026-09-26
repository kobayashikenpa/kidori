// 寸法表の「表」の見せ方：1部材1行で 部材・枚数・仕上がり寸法 W・H・D・木取り寸法 を並べる。
// 仕上がり寸法の数字を押すと、その下の行に内訳（式の各項と値）を開く。もう一度押すと閉じる。
// 部材名を押すと、その下の行に仕上がりの完了のチェックを開く。完了した寸法はグレーにする。
// 切り出し（木取り）の完了は木取り画面のチェックリストで付ける（ここでは木取り寸法をグレーにするだけ）。
// フラッシュの部材は、厚みの内訳を下の行に1行で出す。
// 外すときは、このファイルと ../dimensionView.ts、index.css の「寸法表の表」の段を消し、DimensionScreen の切り替えを外す
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
  // 仕上がりの完了のチェックを開いている部材（1つだけ。内訳とは別に開ける）
  const [checksOpen, setChecksOpen] = useState<string | null>(null)

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
            // フラッシュの部材：厚みの内訳。木取り寸法は、表面材が全部切り出し済みならグレー
            const flush = p.flushId !== undefined ? flushBreakdown(job, p.flushId) : null
            const faceDone = (boardId: string) => p.checks.cutByBoard?.[boardId] === true
            const cutDone =
              cutting && (flush ? flush.faces.length > 0 && flush.faces.every((f) => faceDone(f.boardId)) : p.checks.cut)
            const mismatch = d.errors.some((e) => e.kind === 'thicknessMismatch')
            const ex = AXES.map((a) => explainDimension(job, p.id, a, finished))
            const openAxis = open?.partId === p.id ? open.axis : null
            const openEx = openAxis ? ex[AXES.indexOf(openAxis)] : null
            const checksOn = checksOpen === p.id
            return (
              <Fragment key={p.id}>
                <tr className={openAxis ? 'row-open' : undefined}>
                  <th scope="row" className="c-name">
                    <button
                      type="button"
                      className={`dim-name${checksOn ? ' on' : ''}`}
                      aria-expanded={checksOn}
                      aria-label={`${p.name} の仕上がりの完了`}
                      onClick={() => setChecksOpen(checksOn ? null : p.id)}
                    >
                      {p.name}
                    </button>
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
                {checksOn && (
                  <tr className="dim-checks">
                    <td colSpan={6}>
                      {!cutting ? (
                        <span className="dim-note">寸法だけの部材（枚数0）は完了を付けません</span>
                      ) : (
                        <span className="dim-checks-row">
                          <TableCheck
                            kind="fin"
                            label="仕上がり"
                            ariaLabel={`${p.name} の仕上がり寸法の加工 完了`}
                            checked={finDone}
                            onToggle={() => onCheck(p.id, { finished: !finDone })}
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                )}
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

/** 表の中の仕上がりの「完了」のチェック（青。完了するとグレー） */
function TableCheck(props: {
  kind: 'fin'
  label: string
  ariaLabel: string
  checked: boolean
  onToggle: () => void
}) {
  const { kind, label, ariaLabel, checked, onToggle } = props
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`dim-check ${kind}${checked ? ' done' : ''}`}
      onClick={onToggle}
    >
      <span>{label}</span>
      <span className="check-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      完了
    </button>
  )
}

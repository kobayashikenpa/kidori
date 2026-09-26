// 寸法表の画面：部材ごとのカードで、①仕上がり寸法（青）と ②木取り寸法（橙）を別の段に分けて出す
// 段ごとに「完了」のチェックがあり、チェックした段はグレーにする。メモもカードに出す
import { useMemo } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { AXES, type Board, type Part, type PartChecks, type PartDimensions } from '../../engine/types'
import { boardLabel, setPartChecks } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'

export function DimensionScreen() {
  const { job, run } = useCurrentJob()
  const dims = useMemo(() => computeDimensions(job), [job])
  const pieces = job.parts.reduce((n, p) => n + p.quantity, 0)

  return (
    <section>
      <h2>寸法表</h2>
      <p className="lead">
        部材 {job.parts.length}種類・合計 {pieces}枚。
        <span className="legend fin">① 仕上がり寸法</span>
        <span className="legend cut">② 木取り寸法</span>
      </p>
      <div className="stack">
        {job.parts.map((p, i) => (
          <DimensionCard
            key={p.id}
            part={p}
            dims={dims.parts[i]}
            board={job.boards.find((b) => b.id === p.boardId) ?? null}
            onCheck={(patch) => run((j) => setPartChecks(j, p.id, patch))}
          />
        ))}
      </div>
    </section>
  )
}

interface CardProps {
  part: Part
  dims: PartDimensions
  board: Board | null
  onCheck: (patch: Partial<PartChecks>) => void
}

function DimensionCard({ part, dims: d, board, onCheck }: CardProps) {
  const cutting = part.quantity > 0
  const finDone = cutting && part.checks.finished
  const cutDone = cutting && part.checks.cut

  return (
    <article className="card dim-card">
      <header className="part-head">
        <span className="part-name">{part.name}</span>
        <span className="part-qty num">{cutting ? `×${part.quantity}枚` : '寸法だけ（枚数0）'}</span>
      </header>
      {cutting && (
        <div className="tags">
          {board ? <span className="chip">{boardLabel(board)}</span> : <span className="chip warn">材料が未設定</span>}
          {d.errors.some((e) => e.kind === 'thicknessMismatch') && <span className="chip err">厚みが合わない</span>}
        </div>
      )}
      {part.memo.trim() !== '' && (
        <p className="part-memo">
          <span className="part-memo-label">メモ</span>
          {part.memo}
        </p>
      )}

      {d.errors.length > 0 ? (
        <div className="part-errors" role="group" aria-label="寸法のエラー">
          <p className="band-note" style={{ margin: 0 }}>
            {cutting ? '寸法にエラーがあるため、木取りから除いています。部材の画面で直してください' : '寸法にエラーがあります。部材の画面で直してください'}
          </p>
          {d.errors.map((e, i) => (
            <p key={`${e.axis}-${i}`} className="msg err" style={{ margin: 0 }}>
              {e.axis}：{e.message}
            </p>
          ))}
        </div>
      ) : (
        <>
          <section className={`band fin${finDone ? ' done' : ''}`} aria-label="仕上がり寸法">
            <div className="band-head">
              <h4>
                ① 仕上がり寸法
              </h4>
              {cutting && (
                <CheckButton ariaLabel="仕上がり寸法の加工 完了" checked={finDone} onToggle={() => onCheck({ finished: !finDone })} />
              )}
            </div>
            <div className="band-dims">
              {AXES.map((a) => (
                <div key={a} className={`band-dim${d.thicknessAxis === a ? ' thick' : ''}`}>
                  <span className="ax">
                    {a}
                    {d.thicknessAxis === a && '・厚み'}
                  </span>
                  <span className="v num">{d.finished ? fmt(d.finished[a]) : '―'}</span>
                </div>
              ))}
            </div>
          </section>

          {cutting && (
            <section className={`band cut${cutDone ? ' done' : ''}`} aria-label="木取り寸法">
              <div className="band-head">
                <h4>
                  ② 木取り寸法
                </h4>
                <CheckButton ariaLabel="木取り寸法の切り出し 完了" checked={cutDone} onToggle={() => onCheck({ cut: !cutDone })} />
              </div>
              {d.cutSize && d.faceAxes ? (
                <>
                  <div className="cut-size num">
                    {fmt(d.cutSize[d.faceAxes[0]])}
                    <span className="x">×</span>
                    {fmt(d.cutSize[d.faceAxes[1]])}
                  </div>
                  <p className="band-note">
                    {d.faceAxes[0]} × {d.faceAxes[1]}・切り代 {fmt(d.allowance)} を足した値
                    {d.thicknessAxis && d.finished && `・厚み ${fmt(d.finished[d.thicknessAxis])}`}
                  </p>
                </>
              ) : (
                <p className="band-note">
                  {board ? '厚みが決まらないため出せません（部材の画面で選んでください）' : '材料を選ぶと出ます'}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </article>
  )
}

/** 加工の「完了」のチェック（押しやすい大きさのボタン。押すたびに付ける・外すを切り替える） */
function CheckButton({ ariaLabel, checked, onToggle }: { ariaLabel: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={ariaLabel} className="check-btn" onClick={onToggle}>
      <span className="check-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      完了
    </button>
  )
}

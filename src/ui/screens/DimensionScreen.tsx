// 寸法表の画面：部材ごとのカードで、①仕上がり寸法（青）と ②木取り寸法（橙）を別の段に分けて出す
// 段ごとに「完了」のチェックがあり、チェックした段はグレーにする。メモもカードに出す
// 「カード」「表（試作）」を切り替えられる（表は DimensionTable。選んだほうはこの端末に覚える）
import { useMemo, useState } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { flushBreakdown } from '../../engine/flush'
import { AXES, type Board, type Part, type PartChecks, type PartDimensions } from '../../engine/types'
import { boardLabel, setFlushCutCheck, setPartChecks } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { DimensionTable } from '../components/DimensionTable'
import { Segmented } from '../components/Segmented'
import { loadDimensionView, saveDimensionView, type DimensionView } from '../dimensionView'
import { fmt } from '../format'

export function DimensionScreen() {
  const { job, run } = useCurrentJob()
  const dims = useMemo(() => computeDimensions(job), [job])
  const pieces = job.parts.reduce((n, p) => n + p.quantity, 0)
  const [view, setView] = useState<DimensionView>(loadDimensionView)

  return (
    <section>
      <h2>寸法表</h2>
      <p className="lead">
        部材 {job.parts.length}種類・合計 {pieces}枚。
        <span className="legend fin">① 仕上がり寸法</span>
        <span className="legend cut">② 木取り寸法</span>
      </p>
      <Segmented<DimensionView>
        ariaLabel="寸法表の見せ方"
        value={view}
        options={[
          { value: 'card', label: 'カード' },
          { value: 'table', label: '表（試作）' },
        ]}
        onChange={(v) => {
          setView(v)
          saveDimensionView(v)
        }}
      />
      {view === 'table' ? (
        <>
          <p className="lead" style={{ margin: '8px 0' }}>
            青の数字（仕上がり寸法）を押すと内訳が開きます。完了は、ふつうの部材はカードで、フラッシュの表面材はこの表で付けます（完了したものはグレー）。
          </p>
          <DimensionTable
            job={job}
            dims={dims.parts}
            onFlushCheck={(partId, boardId, done) => run((j) => setFlushCutCheck(j, partId, boardId, done))}
          />
        </>
      ) : (
        <div className="stack" style={{ marginTop: 10 }}>
          {job.parts.map((p, i) => (
            <DimensionCard
              key={p.id}
              part={p}
              dims={dims.parts[i]}
              board={job.boards.find((b) => b.id === p.boardId) ?? null}
            flushName={job.flushes.find((f) => f.id === p.flushId)?.name ?? null}
              flushFaceIds={p.flushId !== undefined ? (flushBreakdown(job, p.flushId)?.faces.map((f) => f.boardId) ?? []) : null}
              onCheck={(patch) => run((j) => setPartChecks(j, p.id, patch))}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface CardProps {
  part: Part
  dims: PartDimensions
  board: Board | null
  /** フラッシュを選んだ部材ならその名前 */
  flushName: string | null
  /** フラッシュの部材なら表面材の材料の id（完了は表面材ごと。表で付ける） */
  flushFaceIds: string[] | null
  onCheck: (patch: Partial<PartChecks>) => void
}

function DimensionCard({ part, dims: d, board, flushName, flushFaceIds, onCheck }: CardProps) {
  const cutting = part.quantity > 0
  const finDone = cutting && part.checks.finished
  // フラッシュの部材は、表面材が全部完了のときだけ ② を完了（グレー）にする（表と同じ）
  const cutDone =
    cutting &&
    (flushFaceIds
      ? flushFaceIds.length > 0 && flushFaceIds.every((id) => part.checks.cutByBoard?.[id] === true)
      : part.checks.cut)
  // 式のエラーがあると仕上がり寸法も出せない。厚みが合わないだけなら仕上がり寸法は出せるので、② 木取り寸法だけ出さない
  const exprErrors = d.errors.filter((e) => e.kind !== 'thicknessMismatch')
  const mismatchErrors = d.errors.filter((e) => e.kind === 'thicknessMismatch')

  return (
    <article className="card dim-card">
      <header className="part-head">
        <span className="part-name">{part.name}</span>
        <span className="part-qty num">{cutting ? `×${part.quantity}枚` : '寸法だけ（枚数0）'}</span>
      </header>
      {cutting && (
        <div className="tags">
          {board ? (
            <span className="chip">{boardLabel(board)}</span>
          ) : flushName ? (
            <span className="chip">{flushName}</span>
          ) : (
            <span className="chip warn">材料が未設定</span>
          )}
          {d.errors.some((e) => e.kind === 'thicknessMismatch') && <span className="chip err">厚みが合わない</span>}
        </div>
      )}
      {part.memo.trim() !== '' && (
        <p className="part-memo">
          <span className="part-memo-label">メモ</span>
          {part.memo}
        </p>
      )}

      {exprErrors.length > 0 ? (
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

          {mismatchErrors.length > 0 && (
            <div className="part-errors" role="group" aria-label="厚みのエラー">
              {mismatchErrors.map((e, i) => (
                <p key={`${e.axis}-${i}`} className="msg err" style={{ margin: 0 }}>
                  {e.axis}：{e.message}
                </p>
              ))}
              <p className="band-note" style={{ margin: 0 }}>
                {cutting ? '木取りから除いています。部材の画面で直してください' : '部材の画面で直してください'}
              </p>
            </div>
          )}

          {cutting && mismatchErrors.length === 0 && (
            <section className={`band cut${cutDone ? ' done' : ''}`} aria-label="木取り寸法">
              <div className="band-head">
                <h4>
                  ② 木取り寸法
                </h4>
                {flushFaceIds ? (
                  <span className="band-note">表面材ごとの完了は「表」で付けます</span>
                ) : (
                  <CheckButton ariaLabel="木取り寸法の切り出し 完了" checked={cutDone} onToggle={() => onCheck({ cut: !cutDone })} />
                )}
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
                  {board || flushName ? '厚みが決まらないため出せません（部材の画面で選んでください）' : '材料を選ぶと出ます'}
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

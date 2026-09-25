// 寸法表の画面：部材ごとのカードで、①仕上がり寸法（青）と ②木取り寸法（橙）を別の段に分けて出す
import { useMemo } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { AXES, type Board, type Part, type PartDimensions } from '../../engine/types'
import { boardLabel } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'

export function DimensionScreen() {
  const { job } = useCurrentJob()
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
          />
        ))}
      </div>
    </section>
  )
}

function DimensionCard({ part, dims: d, board }: { part: Part; dims: PartDimensions; board: Board | null }) {
  const cutting = part.quantity > 0
  // engine が逃げを引いた軸（厚みの寸法以外。厚みが決まらなければ3つとも）
  const clearances = AXES.filter((a) => (part.clearance[a] ?? 0) !== 0 && a !== d.thicknessAxis)

  return (
    <article className="card dim-card">
      <header className="part-head">
        <span className="part-name">{part.name}</span>
        <span className="part-qty num">{cutting ? `×${part.quantity}枚` : '寸法だけ（枚数0）'}</span>
      </header>
      {cutting && (
        <div className="tags">
          {board ? <span className="chip">{boardLabel(board)}</span> : <span className="chip warn">板が未設定</span>}
          {d.thicknessMismatch && <span className="chip warn">厚みを確認</span>}
        </div>
      )}

      {d.errors.length > 0 ? (
        <div className="part-errors">
          {d.errors.map((e, i) => (
            <p key={`${e.axis}-${i}`} className="msg err" style={{ margin: 0 }}>
              {e.axis}：{e.message}
            </p>
          ))}
        </div>
      ) : (
        <>
          <section className="band fin" aria-label="仕上がり寸法">
            <h4>① 仕上がり寸法</h4>
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
            {clearances.length > 0 && (
              <p className="band-note">逃げ {clearances.map((a) => `${a} ${fmt(part.clearance[a]!)}`).join('・')} を引いた値</p>
            )}
          </section>

          {cutting && (
            <section className="band cut" aria-label="木取り寸法">
              <h4>② 木取り寸法</h4>
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
                  {board ? '厚みの寸法が決まらないため出せません（部材の画面で選んでください）' : '板を選ぶと出ます'}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </article>
  )
}

// 部材の画面：部材カードの一覧。押すと編集シート
import { useMemo, useState } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { AXES, type Board, type Part, type PartDimensions } from '../../engine/types'
import { boardLabel } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { PartEditor } from '../components/PartEditor'
import { fmt } from '../format'

export function PartsScreen() {
  const { job } = useCurrentJob()
  const [editing, setEditing] = useState<Part | 'new' | null>(null)
  const dims = useMemo(() => computeDimensions(job), [job])
  const byId = new Map(dims.parts.map((d) => [d.partId, d]))
  const pieces = job.parts.reduce((n, p) => n + p.quantity, 0)

  return (
    <section>
      <h2>部材</h2>
      <p className="lead">
        {job.parts.length}種類・合計 {pieces}枚。押すと編集できます。
      </p>
      <div className="stack">
        {job.parts.map((p) => (
          <PartCard
            key={p.id}
            part={p}
            board={job.boards.find((b) => b.id === p.boardId) ?? null}
            dims={byId.get(p.id)!}
            onOpen={() => setEditing(p)}
          />
        ))}
        <button type="button" className="btn ghost" onClick={() => setEditing('new')}>
          ＋ 部材を追加
        </button>
      </div>
      {editing && (
        <PartEditor
          key={editing === 'new' ? 'new' : editing.id}
          part={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

interface CardProps {
  part: Part
  board: Board | null
  dims: PartDimensions
  onOpen: () => void
}

function PartCard({ part, board, dims: d, onOpen }: CardProps) {
  const noBoard = part.quantity >= 1 && !board
  return (
    <button type="button" className="card part-card" onClick={onOpen}>
      <span className="part-head">
        <span className="part-name">{part.name}</span>
        <span className="part-qty num">{part.quantity > 0 ? `×${part.quantity}枚` : '寸法だけ'}</span>
      </span>
      <span className="tags">
        {part.quantity > 0 && board && <span className="chip">{boardLabel(board)}</span>}
        {noBoard && <span className="chip warn">材料が未設定</span>}
        {d.thicknessMismatch && <span className="chip warn">厚みを確認</span>}
        {d.errors.length > 0 && <span className="chip err">式のエラー</span>}
      </span>
      <span className="part-dims">
        {AXES.map((a) => {
          const v = d.finished?.[a]
          const thick = d.thicknessAxis === a
          return (
            <span
              key={a}
              className={`part-dim${thick ? ' thick' : ''}${d.errors.some((e) => e.axis === a) ? ' bad' : ''}`}
            >
              <span className="ax">
                {a}
                {thick && '・厚み'}
              </span>
              <span className="v num">{v === undefined ? '―' : fmt(v)}</span>
            </span>
          )
        })}
      </span>
      {d.errors.length > 0 && (
        <span className="part-errors">
          {d.errors.map((e, i) => (
            <span key={`${e.axis}-${i}`} className="msg err">
              {e.axis}：{e.message}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

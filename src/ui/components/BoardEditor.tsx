// 板の追加・編集・削除のシート
import { useState } from 'react'
import { BOARD_SIZES, type Board, type BoardGrain, type BoardSizeKind } from '../../engine/types'
import { addBoard, boardLabel, boardUsages, newBoard, removeBoard, updateBoard } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { NumberField } from './NumberField'
import { Segmented } from './Segmented'
import { Sheet } from './Sheet'

const SIZE_KINDS: { value: BoardSizeKind; label: string }[] = [
  { value: 'saburoku', label: '3×6' },
  { value: 'shihachi', label: '4×8' },
  { value: 'custom', label: '自由入力' },
]

interface Props {
  /** 編集する板。null なら新しく足す */
  board: Board | null
  onClose: () => void
}

export function BoardEditor({ board, onClose }: Props) {
  const { job, run } = useCurrentJob()
  const [draft, setDraft] = useState<Board>(() => board ?? newBoard({ material: '' }))
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  // 削除の確認用：この材料から切る部材と、式でこの材料の厚みを使っている部材（部材名と軸）
  const usages = board ? boardUsages(job, board.id) : { cutFrom: [], thickness: [] }
  const users = usages.cutFrom

  const patch = (p: Partial<Board>) => setDraft((d) => ({ ...d, ...p }))

  const setKind = (kind: BoardSizeKind) => {
    if (kind === 'custom') patch({ sizeKind: kind })
    else patch({ sizeKind: kind, width: BOARD_SIZES[kind][0], length: BOARD_SIZES[kind][1], grain: 'long' })
  }

  const save = () => {
    const r = run((j) => (board ? updateBoard(j, board.id, draft) : addBoard(j, draft)))
    if (r.ok) onClose()
    else setError(r.message)
  }

  const remove = () => {
    if (!board) return
    const r = run((j) => removeBoard(j, board.id))
    if (r.ok) onClose()
    else setError(r.message)
  }

  return (
    <Sheet title={board ? `材料の編集：${boardLabel(board)}` : '材料を追加'} onClose={onClose}>
      <div className="field">
        <label className="label" htmlFor="board-material">
          材料
        </label>
        <input
          id="board-material"
          className="input"
          value={draft.material}
          placeholder="例：シナランバー"
          onChange={(e) => patch({ material: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="board-thickness">
          厚み
        </label>
        <NumberField id="board-thickness" value={draft.thickness} onChange={(v) => v !== null && patch({ thickness: v })} />
        <span className="hint">材料と厚みの組み合わせで区別します（同じ組み合わせは2つ作れません）</span>
      </div>
      <div className="field">
        <span className="label">サイズ</span>
        <Segmented ariaLabel="材料のサイズ" value={draft.sizeKind} options={SIZE_KINDS} onChange={setKind} />
        {draft.sizeKind !== 'custom' ? (
          <span className="hint num">
            {draft.width} × {draft.length} mm（木目は長手方向）
          </span>
        ) : (
          <>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="board-w">
                  妻手
                </label>
                <NumberField id="board-w" value={draft.width} onChange={(v) => v !== null && patch({ width: v })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="board-l">
                  長手
                </label>
                <NumberField id="board-l" value={draft.length} onChange={(v) => v !== null && patch({ length: v })} />
              </div>
            </div>
            <span className="label" style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
              木目の方向
            </span>
            <Segmented<BoardGrain>
              ariaLabel="木目の方向"
              value={draft.grain}
              options={[
                { value: 'long', label: '長手方向' },
                { value: 'short', label: '妻手方向' },
              ]}
              onChange={(v) => patch({ grain: v })}
            />
          </>
        )}
      </div>

      {error && <p className="msg err">{error}</p>}

      <div className="sheet-foot">
        <button type="button" className="btn primary" onClick={save}>
          {board ? '保存する' : '追加する'}
        </button>
      </div>

      {board &&
        (confirming ? (
          <div className="card stack" role="alertdialog" aria-label="材料の削除の確認">
            {users.length > 0 ? (
              <p className="msg warn" style={{ margin: 0 }}>
                この材料は <b>{users.join('・')}</b> で使っています。削除すると、これらの部材は「材料が未設定」になります。
              </p>
            ) : (
              usages.thickness.length === 0 && <p style={{ margin: 0 }}>この材料を使っている部材はありません。</p>
            )}
            {usages.thickness.length > 0 && (
              <p className="msg warn" style={{ margin: 0 }}>
                <b>{usages.thickness.join('・')}</b> の式がこの材料の厚みを使っています。削除すると、その寸法は「削除した材料の厚みを使っています」のエラーになります。
              </p>
            )}
            <p style={{ margin: 0 }}>「{boardLabel(board)}」を削除しますか？</p>
            <div className="sheet-foot">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                やめる
              </button>
              <button type="button" className="btn danger solid" onClick={remove}>
                削除する
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn danger wide" onClick={() => setConfirming(true)}>
            この材料を削除
          </button>
        ))}
    </Sheet>
  )
}

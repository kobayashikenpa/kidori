// 設定の画面の材料の一覧：材料名と厚みだけを入れて追加・編集、削除（使っている部材を示して確認）。
// 材料のサイズ（3×6・4×8・自由入力）と木目の方向は、木取りの画面で選ぶ（仕様書 5.1・9）
import { useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { flushesEmptiedByBoards, flushesUsingBoards } from '../../engine/flush'
import type { Board } from '../../engine/types'
import { addBoard, boardLabel, boardsUsages, newBoard, partsUsingBoard, removeBoards, updateBoard } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { closeKeyboard } from '../keyboard'
import { NumberField } from './NumberField'
import { SettingsList } from './SettingsList'

export function BoardEditor() {
  const { job, run } = useCurrentJob()
  return (
    <div className="stack">
      <p className="lead" style={{ margin: 0 }}>
        材料名と厚みで区別します。材料のサイズ（3×6・4×8）は木取りの画面で選びます。
      </p>
      <SettingsList<Board>
        kind="材料"
        idPrefix="board"
        // 並びは あとから足した材料（足した順）→ 最初から入っている材料（仕様書 5.1）
        items={orderedBoards(job)}
        label={boardLabel}
        usage={(b) => {
          const users = partsUsingBoard(job, b.id)
          const flushes = flushesUsingBoards(job, [b.id])
          const text = users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'
          return flushes.length > 0 ? `${text}　フラッシュ：${flushes.join('・')}` : text
        }}
        add={<BoardForm board={null} done={() => {}} />}
        renderEdit={(b, done) => <BoardForm board={b} done={done} />}
        removeWarning={(ids) => {
          const u = boardsUsages(job, ids)
          const one = ids.length > 1 ? '選んだ材料' : 'この材料'
          const emptied = flushesEmptiedByBoards(job, ids)
          if (u.cutFrom.length === 0 && u.thickness.length === 0 && u.flushes.length === 0) return null
          return (
            <>
              {u.cutFrom.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  {one}は <b>{u.cutFrom.join('・')}</b> で使っています。削除すると、これらの部材は「材料が未設定」になります。
                </p>
              )}
              {u.thickness.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  <b>{u.thickness.join('・')}</b> の式が{one}の厚みを使っています。削除すると、その寸法は「削除した材料の厚みを使っています」のエラーになります。
                </p>
              )}
              {u.flushes.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  フラッシュ <b>{u.flushes.join('・')}</b> の表面材に{one}を使っています。削除すると、その表面材は外れて、フラッシュの厚みが変わります。
                </p>
              )}
              {emptied.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  <b>{emptied.join('・')}</b> の表面材が無くなります（木取りできなくなります）。
                </p>
              )}
            </>
          )
        }}
        onRemove={(ids) => run((j) => removeBoards(j, ids))}
        emptyText="材料がまだありません。"
      />
    </div>
  )
}

/** 材料の追加（board が null）・編集。材料名と厚みだけ。厚みは空欄から始め、入れないと追加できない */
function BoardForm({ board, done }: { board: Board | null; done: () => void }) {
  const { run } = useCurrentJob()
  const [material, setMaterial] = useState(board?.material ?? '')
  const [thickness, setThickness] = useState<number | null>(board ? board.thickness : null)
  const [error, setError] = useState<string | null>(null)
  // 追加の欄は入れ直すたびに作り直して、打ちかけの数字を消す
  const [round, setRound] = useState(0)
  const pre = board ? `board-edit-${board.id}` : 'board-add'

  const save = () => {
    if (thickness === null) {
      setError('厚みを入れてください（例：18）')
      return
    }
    const r = run((j) =>
      board ? updateBoard(j, board.id, { material, thickness }) : addBoard(j, newBoard({ material, thickness })),
    )
    if (!r.ok) return setError(r.message)
    closeKeyboard()
    if (!board) {
      setMaterial('')
      setThickness(null)
      setError(null)
      setRound((n) => n + 1)
    }
    done()
  }

  const fields = (
    <>
      {!board && <span className="label">材料を追加（材料名と厚み）</span>}
      <div className="list-add">
        <div className="field" style={{ flex: 2, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-material`}>
            材料名
          </label>
          <input
            id={`${pre}-material`}
            className="input"
            value={material}
            placeholder="例：シナランバー"
            enterKeyHint="next"
            onChange={(e) => {
              setMaterial(e.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-thickness`}>
            厚み
          </label>
          <NumberField
            key={round}
            id={`${pre}-thickness`}
            allowEmpty
            placeholder="例：18"
            value={thickness}
            onChange={(v) => {
              setThickness(v)
              setError(null)
            }}
          />
        </div>
      </div>
      {thickness === null && (
        <span className="msg warn">厚みを入れてください。入れないと{board ? '変えられません' : '追加できません'}</span>
      )}
      {error && (
        <p className="msg err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </>
  )

  if (board) {
    return (
      <>
        {fields}
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={done}>
            やめる
          </button>
          <button type="button" className="btn primary" aria-disabled={thickness === null} onClick={save}>
            変える
          </button>
        </div>
      </>
    )
  }
  return (
    <div className="card stack">
      {fields}
      <button type="button" className="btn primary" aria-disabled={thickness === null} onClick={save}>
        追加
      </button>
    </div>
  )
}

// 設定の画面の材料のタブ（第2.7版。architecture.md 19.3）：材料名ごとに1行、厚みのボタンと［＋］。
// 厚みのボタン → 下から出る編集（材料名・厚み・木取りしない・使っている部材・削除）。［＋］→ その材料名の厚みを足す。
// 一番下に「＋ 材料名を追加」。選んで削除は、厚みのボタンを選ぶ形。
// 材料のサイズ（3×6・4×8・自由入力）と木目の方向は、木取りの画面で選ぶ（仕様書 5.1・9）
import { useEffect, useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { flushesEmptiedByBoards, flushesUsingBoards } from '../../engine/flush'
import type { Board, Job } from '../../engine/types'
import {
  addBoard,
  boardLabel,
  boardsUsages,
  newBoard,
  partsUsingBoard,
  removeBoards,
  updateBoard,
} from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'
import { closeKeyboard } from '../keyboard'
import { materialNameGroups } from '../materials'
import { NumberField } from './NumberField'
import { Sheet } from './Sheet'

type BoardSheet = { kind: 'edit'; id: string } | { kind: 'add'; material: string } | { kind: 'new' }

/** 厚みのボタンの読み上げ（例：芯材 15mm 木取りしない） */
function chipLabel(b: Board): string {
  return b.noCut === true ? `${boardLabel(b)} 木取りしない` : boardLabel(b)
}

export function BoardEditor() {
  const { job, run } = useCurrentJob()
  const [sheet, setSheet] = useState<BoardSheet | null>(null)
  // 選んで削除：選ぶモードか・選んだ id・確認を出しているか
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const boards = orderedBoards(job)
  const groups = materialNameGroups(boards)
  const chosen = boards.filter((b) => selected.includes(b.id))

  useEffect(() => {
    if (bulkConfirm)
      document.getElementById('board-bulk-confirm')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [bulkConfirm])

  const stopSelect = () => {
    setSelecting(false)
    setSelected([])
    setBulkConfirm(false)
    setBulkError(null)
  }
  const toggle = (id: string) => {
    setBulkConfirm(false)
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }
  const removeChosen = () => {
    const r = run((j) =>
      removeBoards(
        j,
        chosen.map((b) => b.id),
      ),
    )
    if (r.ok) stopSelect()
    else setBulkError(r.message)
  }
  const close = () => setSheet(null)

  return (
    <div className="stack" role="group" aria-label="材料の一覧">
      {boards.length === 0 && (
        <p className="lead" style={{ margin: 0 }}>
          材料がまだありません。
        </p>
      )}
      {boards.length > 0 && !selecting && (
        <button
          type="button"
          className="btn danger list-select-start"
          onClick={() => {
            setSelected([])
            setSelecting(true)
          }}
        >
          選んで削除
        </button>
      )}
      {selecting && (
        <p className="lead" style={{ margin: 0 }}>
          削除する材料の厚みを選んでください（いくつでも選べます）。
        </p>
      )}
      {groups.map((g) => (
        <div key={g.name} className="card mat-row" role="group" aria-label={g.name}>
          <span className="mat-name">{g.name}</span>
          <div className="mat-chips">
            {g.boards.map((b) => {
              const noCut = b.noCut === true
              const inner = (
                <>
                  <span className="mat-thick">{fmt(b.thickness)}</span>
                  {noCut && <span className="mat-nocut">木取りしない</span>}
                </>
              )
              if (selecting) {
                const on = selected.includes(b.id)
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={chipLabel(b)}
                    className={`mat-chip pick${noCut ? ' nocut' : ''}${on ? ' on' : ''}`}
                    onClick={() => toggle(b.id)}
                  >
                    {on && (
                      <span className="mat-tick" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {inner}
                  </button>
                )
              }
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-label={chipLabel(b)}
                  className={`mat-chip${noCut ? ' nocut' : ''}`}
                  onClick={() => setSheet({ kind: 'edit', id: b.id })}
                >
                  {inner}
                </button>
              )
            })}
            {!selecting && (
              <button
                type="button"
                className="mat-chip add"
                aria-label={`${g.name} の厚みを足す`}
                onClick={() => setSheet({ kind: 'add', material: g.name })}
              >
                ＋
              </button>
            )}
          </div>
        </div>
      ))}
      {!selecting && (
        <button type="button" className="btn ghost" onClick={() => setSheet({ kind: 'new' })}>
          ＋ 材料名を追加
        </button>
      )}
      {selecting &&
        (bulkConfirm && chosen.length > 0 ? (
          <div
            id="board-bulk-confirm"
            className="card stack confirm"
            role="alertdialog"
            aria-label="選んだ材料の削除の確認"
          >
            <BoardRemoveWarning job={job} ids={chosen.map((b) => b.id)} />
            <p style={{ margin: 0 }}>
              選んだ{chosen.length}件（{chosen.map(boardLabel).join('・')}）を削除しますか？
            </p>
            {bulkError && (
              <p className="msg err" role="alert" style={{ margin: 0 }}>
                削除できませんでした：{bulkError}
              </p>
            )}
            <div className="sheet-foot">
              <button type="button" className="btn" onClick={() => setBulkConfirm(false)}>
                やめる
              </button>
              <button type="button" className="btn danger solid" onClick={removeChosen}>
                削除する
              </button>
            </div>
          </div>
        ) : (
          <div className="card sheet-foot list-bulk">
            <button type="button" className="btn" onClick={stopSelect}>
              やめる
            </button>
            <button
              type="button"
              className="btn danger solid"
              aria-disabled={chosen.length === 0}
              onClick={() => chosen.length > 0 && setBulkConfirm(true)}
            >
              選んだ{chosen.length}件を削除
            </button>
          </div>
        ))}
      {sheet?.kind === 'edit' && <BoardEditSheet id={sheet.id} onClose={close} />}
      {sheet?.kind === 'add' && (
        <Sheet title={`${sheet.material} の厚みを足す`} onClose={close}>
          <BoardForm board={null} presetMaterial={sheet.material} done={close} />
        </Sheet>
      )}
      {sheet?.kind === 'new' && (
        <Sheet title="材料名を追加" onClose={close}>
          <BoardForm board={null} done={close} />
        </Sheet>
      )}
    </div>
  )
}

/** 厚みのボタンから開く、1つの材料の編集（材料名・厚み・木取りしない・使っている部材・削除） */
function BoardEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { job, run } = useCurrentJob()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b = job.boards.find((x) => x.id === id)
  if (!b) return null
  const users = partsUsingBoard(job, b.id)
  const flushes = flushesUsingBoards(job, [b.id])
  const usage = users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'
  const remove = () => {
    const r = run((j) => removeBoards(j, [b.id]))
    if (r.ok) onClose()
    else setError(r.message)
  }
  return (
    <Sheet title={`材料の編集：${boardLabel(b)}`} onClose={onClose}>
      <p className="lead" style={{ margin: 0 }}>
        {usage}
        {flushes.length > 0 && `　材料グループ：${flushes.join('・')}`}
      </p>
      <BoardForm board={b} done={onClose} />
      {confirm ? (
        <div className="card stack confirm" role="alertdialog" aria-label={`${boardLabel(b)} の削除の確認`}>
          <BoardRemoveWarning job={job} ids={[b.id]} />
          <p style={{ margin: 0 }}>「{boardLabel(b)}」を削除しますか？</p>
          {error && (
            <p className="msg err" role="alert" style={{ margin: 0 }}>
              削除できませんでした：{error}
            </p>
          )}
          <div className="sheet-foot">
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              やめる
            </button>
            <button type="button" className="btn danger solid" onClick={remove}>
              削除する
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
          この材料を削除
        </button>
      )}
    </Sheet>
  )
}

/** 材料を消す前の知らせ（使っている部材・式・材料グループ）。何も無ければ出さない */
function BoardRemoveWarning({ job, ids }: { job: Job; ids: string[] }) {
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
          <b>{u.thickness.join('・')}</b> の式が{one}
          の厚みを使っています。削除すると、その寸法は「削除した材料の厚みを使っています」のエラーになります。
        </p>
      )}
      {u.flushes.length > 0 && (
        <p className="msg warn" style={{ margin: 0 }}>
          材料グループ：<b>{u.flushes.join('・')}</b> の中身に{one}
          を使っています。削除すると、その中身は外れて、材料グループの厚みが変わります。
        </p>
      )}
      {emptied.length > 0 && (
        <p className="msg warn" style={{ margin: 0 }}>
          <b>{emptied.join('・')}</b> の中身が無くなります（木取りできなくなります）。
        </p>
      )}
    </>
  )
}

/**
 * 材料の追加（board が null）・編集。追加は下から出る編集の中に置く（第2.7版）。材料名と厚み・木取りしない。厚みは空欄から始め、入れないと追加できない。
 */
export function BoardForm({
  board,
  presetMaterial,
  done,
}: {
  board: Board | null
  /** 厚みを足すとき（［＋］）：材料名を入れておき、材料名の欄は出さない */
  presetMaterial?: string
  done: () => void
}) {
  const { run } = useCurrentJob()
  const [material, setMaterial] = useState(board?.material ?? presetMaterial ?? '')
  const [thickness, setThickness] = useState<number | null>(board ? board.thickness : null)
  const [noCut, setNoCut] = useState(board?.noCut === true)
  const [error, setError] = useState<string | null>(null)
  const pre = board ? `board-edit-${board.id}` : 'board-add'

  const save = () => {
    if (thickness === null) {
      setError('厚みを入れてください（例：18）')
      return
    }
    const r = run((j) =>
      board
        ? updateBoard(j, board.id, { material, thickness, noCut: noCut ? true : undefined })
        : addBoard(j, newBoard({ material, thickness, ...(noCut ? { noCut: true as const } : {}) })),
    )
    if (!r.ok) return setError(r.message)
    closeKeyboard()
    done()
  }

  const fields = (
    <>
      <div className="list-add">
        {presetMaterial !== undefined ? (
          <div className="field" style={{ flex: 2, minWidth: 0 }}>
            <span className="label">材料名</span>
            <span className="mat-preset">{presetMaterial}</span>
          </div>
        ) : (
          <div className="field" style={{ flex: 2, minWidth: 0 }}>
            <label className="label" htmlFor={`${pre}-material`}>
              材料名
            </label>
            <input
              id={`${pre}-material`}
              className="input"
              value={material}
              placeholder="例：ラワン"
              enterKeyHint="next"
              onChange={(e) => {
                setMaterial(e.target.value)
                setError(null)
              }}
            />
          </div>
        )}
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-thickness`}>
            厚み
          </label>
          <NumberField
            id={`${pre}-thickness`}
            ariaLabel="材料の厚み"
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
      <button
        type="button"
        role="checkbox"
        aria-checked={noCut}
        className={`opt-check${noCut ? ' on' : ''}`}
        onClick={() => {
          setNoCut((v) => !v)
          setError(null)
        }}
      >
        <span className="check-box" aria-hidden="true">
          {noCut ? '✓' : ''}
        </span>
        <span>木取りしない（例：芯材）</span>
      </button>
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

  return (
    <>
      {fields}
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={done}>
          やめる
        </button>
        <button type="button" className="btn primary" aria-disabled={thickness === null} onClick={save}>
          {board ? '変える' : '追加'}
        </button>
      </div>
    </>
  )
}

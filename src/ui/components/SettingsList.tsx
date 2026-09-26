// 設定の画面の一覧（逃げ・材料で共通の見た目と操作）。
// 上に追加の入力、その下に1行ずつ 名前・使っている部材・「編集」「削除」。
// 編集・削除の確認は、その行がその場で形を変える。逃げ・材料の操作は呼ぶ側から受け取る
import { useEffect, useState, type ReactNode } from 'react'
import type { OpResult } from '../../store/jobs'

interface Props<T extends { id: string }> {
  /** 一覧の名前（逃げ・材料）。確認の文に使う */
  kind: string
  /** 画面の中で重ならない id の頭 */
  idPrefix: string
  items: readonly T[]
  /** 行の名前（逃げ1・シナランバー 18mm） */
  label: (item: T) => string
  /** 行に出す「使っている部材」の文 */
  usage: (item: T) => string
  /** 上に置く追加の入力 */
  add: ReactNode
  /** 編集の形（done で一覧の形に戻す） */
  renderEdit: (item: T, done: () => void) => ReactNode
  /** 削除の確認に出す、使っている部材の知らせ（無ければ null） */
  removeWarning: (ids: string[]) => ReactNode
  /** 消す。失敗したら理由を返す（画面に出す） */
  onRemove: (ids: string[]) => OpResult
  /** 1件も無いときの文 */
  emptyText: string
}

export function SettingsList<T extends { id: string }>({
  kind,
  idPrefix,
  items,
  label,
  usage,
  add,
  renderEdit,
  removeWarning,
  onRemove,
  emptyText,
}: Props<T>) {
  const [editId, setEditId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // 選んで削除：選ぶモードか・選んだ id・確認を出しているか
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  // 消えた項目は選んだものから外す（並びは一覧の順）
  const chosen = items.filter((it) => selected.includes(it.id)).map((it) => it.id)

  // 確認の形に替えたら、見える位置へ動かす（キーボードが閉じて画面が動いても見失わないように）
  useEffect(() => {
    if (!removeId) return
    document.getElementById(`${idPrefix}-confirm-${removeId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [removeId, idPrefix])

  const startRemove = (id: string) => {
    setEditId(null)
    setRemoveError(null)
    setRemoveId(id)
  }
  const cancelRemove = () => {
    setRemoveId(null)
    setRemoveError(null)
  }
  const startSelect = () => {
    setEditId(null)
    cancelRemove()
    setSelected([])
    setBulkConfirm(false)
    setBulkError(null)
    setSelecting(true)
  }
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
    const r = onRemove(chosen)
    if (r.ok) stopSelect()
    else setBulkError(r.message)
  }

  useEffect(() => {
    if (bulkConfirm) document.getElementById(`${idPrefix}-bulk-confirm`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [bulkConfirm, idPrefix])

  const remove = (id: string) => {
    const r = onRemove([id])
    if (r.ok) cancelRemove()
    else setRemoveError(r.message)
  }

  return (
    <div className="stack" role="group" aria-label={`${kind}の一覧`}>
      {!selecting && add}
      {items.length === 0 && <p className="lead" style={{ margin: 0 }}>{emptyText}</p>}
      {items.length > 0 && !selecting && (
        <button type="button" className="btn danger list-select-start" onClick={startSelect}>
          選んで削除
        </button>
      )}
      {selecting && <p className="lead" style={{ margin: 0 }}>削除する{kind}を選んでください（いくつでも選べます）。</p>}
      {items.map((item) => {
        const name = label(item)
        if (selecting) {
          const on = chosen.includes(item.id)
          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              className={`card list-item list-check${on ? ' on' : ''}`}
              onClick={() => toggle(item.id)}
            >
              <span className="check-box" aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              <span className="list-info">
                <span className="list-name">{name}</span>
                <span className="lead" style={{ margin: 0 }}>
                  {usage(item)}
                </span>
              </span>
            </button>
          )
        }
        if (editId === item.id) {
          return (
            <div key={item.id} className="card stack" aria-label={`${name} を編集`}>
              {renderEdit(item, () => setEditId(null))}
            </div>
          )
        }
        if (removeId === item.id) {
          return (
            <div
              key={item.id}
              id={`${idPrefix}-confirm-${item.id}`}
              className="card stack confirm"
              role="alertdialog"
              aria-label={`${name} の削除の確認`}
            >
              {removeWarning([item.id])}
              <p style={{ margin: 0 }}>「{name}」を削除しますか？</p>
              {removeError && (
                <p className="msg err" role="alert" style={{ margin: 0 }}>
                  削除できませんでした：{removeError}
                </p>
              )}
              <div className="sheet-foot">
                <button type="button" className="btn" onClick={cancelRemove}>
                  やめる
                </button>
                <button type="button" className="btn danger solid" onClick={() => remove(item.id)}>
                  削除する
                </button>
              </div>
            </div>
          )
        }
        return (
          <div key={item.id} className="card list-item">
            <div className="list-info">
              <span className="list-name">{name}</span>
              <span className="lead" style={{ margin: 0 }}>
                {usage(item)}
              </span>
            </div>
            <div className="list-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  cancelRemove()
                  setEditId(item.id)
                }}
              >
                編集
              </button>
              <button type="button" className="btn danger" onClick={() => startRemove(item.id)}>
                削除
              </button>
            </div>
          </div>
        )
      })}
      {selecting &&
        (bulkConfirm && chosen.length > 0 ? (
          <div id={`${idPrefix}-bulk-confirm`} className="card stack confirm" role="alertdialog" aria-label={`選んだ${kind}の削除の確認`}>
            {removeWarning(chosen)}
            <p style={{ margin: 0 }}>
              選んだ{chosen.length}件（{items.filter((it) => chosen.includes(it.id)).map(label).join('・')}）を削除しますか？
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
    </div>
  )
}


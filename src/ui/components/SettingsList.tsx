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
  const remove = (id: string) => {
    const r = onRemove([id])
    if (r.ok) cancelRemove()
    else setRemoveError(r.message)
  }

  return (
    <div className="stack" role="group" aria-label={`${kind}の一覧`}>
      {add}
      {items.length === 0 && <p className="lead" style={{ margin: 0 }}>{emptyText}</p>}
      {items.map((item) => {
        const name = label(item)
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
    </div>
  )
}


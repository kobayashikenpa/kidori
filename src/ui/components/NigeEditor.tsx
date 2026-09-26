// 設定の画面の逃げの一覧：寸法を入れるだけで追加（名前は「逃げ＋寸法」）、寸法の変更、削除（使っている部材を示して確認）
import { useState } from 'react'
import { nigeName } from '../../engine/defaults'
import type { Nige } from '../../engine/types'
import { addNige, nigeUsages, removeNige, updateNige } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt, parseNum } from '../format'

/** 入力欄の文字を逃げの寸法にする。読めなければ理由 */
function readValue(text: string): number | string {
  const v = parseNum(text)
  if (v === null) return '逃げの寸法を入れてください'
  if (Number.isNaN(v)) return '数字で入れてください'
  return v
}

export function NigeEditor() {
  const { job, run } = useCurrentJob()
  const list = job.settings.nige
  const [adding, setAdding] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  // 寸法を変えている逃げ・消そうとしている逃げ（どちらも1つだけ）
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)

  const add = () => {
    const v = readValue(adding)
    if (typeof v === 'string') return setAddError(v)
    const r = run((j) => addNige(j, v))
    if (r.ok) {
      setAdding('')
      setAddError(null)
    } else setAddError(r.message)
  }

  const startEdit = (n: Nige) => {
    setRemoveId(null)
    setEditId(n.id)
    setEditText(fmt(n.value))
    setEditError(null)
  }
  const saveEdit = (id: string) => {
    const v = readValue(editText)
    if (typeof v === 'string') return setEditError(v)
    const r = run((j) => updateNige(j, id, v))
    if (r.ok) setEditId(null)
    else setEditError(r.message)
  }
  const remove = (id: string) => {
    run((j) => removeNige(j, id))
    setRemoveId(null)
  }

  return (
    <div className="stack">
      <p className="lead" style={{ margin: 0 }}>
        式の中で引いて使います（例：天地板.W − 逃げ1）。寸法を変えると、使っている式の値もついてきます。
      </p>
      {list.length === 0 && <p className="lead" style={{ margin: 0 }}>逃げがまだありません。</p>}
      {list.map((n) => {
        const users = nigeUsages(job, n.id)
        if (editId === n.id) {
          return (
            <div key={n.id} className="card stack" aria-label={`${nigeName(n.value)} の寸法を変える`}>
              <label className="label" htmlFor={`nige-edit-${n.id}`}>
                {nigeName(n.value)} の寸法
              </label>
              <span className="unit-input">
                <input
                  id={`nige-edit-${n.id}`}
                  className={`input num${editError ? ' bad' : ''}`}
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit(n.id)}
                />
                <span className="unit">mm</span>
              </span>
              {editError && <p className="msg err" style={{ margin: 0 }}>{editError}</p>}
              <div className="sheet-foot">
                <button type="button" className="btn" onClick={() => setEditId(null)}>
                  やめる
                </button>
                <button type="button" className="btn primary" onClick={() => saveEdit(n.id)}>
                  変える
                </button>
              </div>
            </div>
          )
        }
        if (removeId === n.id) {
          return (
            <div key={n.id} className="card stack" role="alertdialog" aria-label={`${nigeName(n.value)} の削除の確認`}>
              {users.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  <b>{users.join('・')}</b> の式がこの逃げを使っています。削除すると、その寸法は「削除した逃げを使っています」のエラーになります。
                </p>
              )}
              <p style={{ margin: 0 }}>「{nigeName(n.value)}」を削除しますか？</p>
              <div className="sheet-foot">
                <button type="button" className="btn" onClick={() => setRemoveId(null)}>
                  やめる
                </button>
                <button type="button" className="btn danger solid" onClick={() => remove(n.id)}>
                  削除する
                </button>
              </div>
            </div>
          )
        }
        return (
          <div key={n.id} className="card nige-item">
            <div className="nige-info">
              <span className="board-name">{nigeName(n.value)}</span>
              <span className="lead" style={{ margin: 0 }}>
                {users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'}
              </span>
            </div>
            <div className="nige-actions">
              <button type="button" className="btn" onClick={() => startEdit(n)}>
                寸法を変える
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  setEditId(null)
                  setRemoveId(n.id)
                }}
              >
                削除
              </button>
            </div>
          </div>
        )
      })}

      <div className="card stack">
        <label className="label" htmlFor="nige-add">
          逃げを追加（寸法だけ入れる）
        </label>
        <div className="nige-add">
          <span className="unit-input">
            <input
              id="nige-add"
              className={`input num${addError ? ' bad' : ''}`}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="例：2"
              value={adding}
              onChange={(e) => {
                setAdding(e.target.value)
                setAddError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <span className="unit">mm</span>
          </span>
          <button type="button" className="btn primary" onClick={add}>
            追加
          </button>
        </div>
        {addError && (
          <p className="msg err" role="alert" style={{ margin: 0 }}>
            {addError}
          </p>
        )}
      </div>
    </div>
  )
}

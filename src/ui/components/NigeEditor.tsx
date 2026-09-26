// 設定の画面の逃げの一覧：寸法を入れるだけで追加（名前は「逃げ＋寸法」）、寸法の変更、削除（使っている部材を示して確認）
import { useState } from 'react'
import { nigeName } from '../../engine/defaults'
import type { Nige } from '../../engine/types'
import { addNige, nigesUsages, nigeUsages, removeNiges, updateNige } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt, parseNum } from '../format'
import { closeKeyboard } from '../keyboard'
import { SettingsList } from './SettingsList'

/** 入力欄の文字を逃げの寸法にする。読めなければ理由 */
function readValue(text: string): number | string {
  const v = parseNum(text)
  if (v === null) return '逃げの寸法を入れてください'
  if (Number.isNaN(v)) return '数字で入れてください'
  return v
}

export function NigeEditor() {
  const { job, run } = useCurrentJob()
  return (
    <div className="stack">
      <p className="lead" style={{ margin: 0 }}>
        式の中で引いて使います（例：天地板.W − 逃げ1）。寸法を変えると、使っている式の値もついてきます。
      </p>
      <SettingsList<Nige>
        kind="逃げ"
        idPrefix="nige"
        items={job.settings.nige}
        label={(n) => nigeName(n.value)}
        usage={(n) => {
          const users = nigeUsages(job, n.id)
          return users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'
        }}
        add={<NigeAdd />}
        renderEdit={(n, done) => <NigeEdit nige={n} done={done} />}
        removeWarning={(ids) => {
          const users = nigesUsages(job, ids)
          if (users.length === 0) return null
          return (
            <p className="msg warn" style={{ margin: 0 }}>
              <b>{users.join('・')}</b> の式が{ids.length > 1 ? '選んだ逃げ' : 'この逃げ'}を使っています。削除すると、その寸法は「削除した逃げを使っています」のエラーになります。
            </p>
          )
        }}
        onRemove={(ids) => run((j) => removeNiges(j, ids))}
        emptyText="逃げがまだありません。"
      />
    </div>
  )
}

/** 逃げの追加（寸法だけ入れる） */
function NigeAdd() {
  const { run } = useCurrentJob()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    const v = readValue(text)
    if (typeof v === 'string') return setError(v)
    const r = run((j) => addNige(j, v))
    if (r.ok) {
      setText('')
      setError(null)
      closeKeyboard()
    } else setError(r.message)
  }
  return (
    <div className="card stack">
      <label className="label" htmlFor="nige-add">
        逃げを追加（寸法だけ入れる）
      </label>
      <div className="list-add">
        <span className="unit-input">
          <input
            id="nige-add"
            className={`input num${error ? ' bad' : ''}`}
            inputMode="decimal"
            enterKeyHint="done"
            placeholder="例：2"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <span className="unit">mm</span>
        </span>
        <button type="button" className="btn primary" onClick={add}>
          追加
        </button>
      </div>
      {error && (
        <p className="msg err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  )
}

/** 逃げの寸法を変える */
function NigeEdit({ nige, done }: { nige: Nige; done: () => void }) {
  const { run } = useCurrentJob()
  const [text, setText] = useState(fmt(nige.value))
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    const v = readValue(text)
    if (typeof v === 'string') return setError(v)
    const r = run((j) => updateNige(j, nige.id, v))
    if (r.ok) {
      closeKeyboard()
      done()
    } else setError(r.message)
  }
  return (
    <>
      <label className="label" htmlFor={`nige-edit-${nige.id}`}>
        {nigeName(nige.value)} の寸法
      </label>
      <span className="unit-input">
        <input
          id={`nige-edit-${nige.id}`}
          className={`input num${error ? ' bad' : ''}`}
          inputMode="decimal"
          enterKeyHint="done"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <span className="unit">mm</span>
      </span>
      {error && <p className="msg err" style={{ margin: 0 }}>{error}</p>}
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={done}>
          やめる
        </button>
        <button type="button" className="btn primary" onClick={save}>
          変える
        </button>
      </div>
    </>
  )
}

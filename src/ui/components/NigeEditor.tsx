// 設定の画面の調整寸法（逃げ・ほぞなど）の一覧：名前と寸法で追加・変更、削除（使っている部材を示して確認）。
// 材料の一覧と同じ見た目・操作（SettingsList）
import { useState } from 'react'
import { nigeName } from '../../engine/defaults'
import type { Nige } from '../../engine/types'
import { addNige, nigesUsages, nigeUsages, removeNiges, updateNige } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt, parseNum } from '../format'
import { closeKeyboard } from '../keyboard'
import { SettingsList } from './SettingsList'

/** 入力欄の名前と寸法を読む。読めなければ理由 */
function readInput(name: string, text: string): { name: string; value: number } | string {
  if (name.trim() === '') return '名前を入れてください（例：逃げ・ほぞ）'
  const v = parseNum(text)
  if (v === null) return '寸法を入れてください'
  if (Number.isNaN(v)) return '寸法は数字で入れてください'
  return { name: name.trim(), value: v }
}

export function NigeEditor() {
  const { job, run } = useCurrentJob()
  return (
    <div className="stack">
      <p className="lead" style={{ margin: 0 }}>
        逃げ・ほぞなど、仕上がり寸法を伸ばしたり短くしたりする寸法です。式の中で足したり引いたりして使います（例：天地板.W − 逃げ1、棚板.D + ほぞ15）。名前や寸法を変えると、使っている式もついてきます。
      </p>
      <SettingsList<Nige>
        kind="調整寸法"
        idPrefix="nige"
        items={job.settings.nige}
        label={(n) => nigeName(n)}
        usage={(n) => {
          const users = nigeUsages(job, n.id)
          return users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'
        }}
        add={<NigeForm nige={null} done={() => {}} />}
        renderEdit={(n, done) => <NigeForm nige={n} done={done} />}
        removeWarning={(ids) => {
          const users = nigesUsages(job, ids)
          if (users.length === 0) return null
          return (
            <p className="msg warn" style={{ margin: 0 }}>
              <b>{users.join('・')}</b> の式が{ids.length > 1 ? '選んだ調整寸法' : 'この調整寸法'}を使っています。削除すると、その寸法は「削除した調整寸法を使っています」のエラーになります。
            </p>
          )
        }}
        onRemove={(ids) => run((j) => removeNiges(j, ids))}
        emptyText="調整寸法がまだありません。"
      />
    </div>
  )
}

/** 調整寸法の追加（nige が null）・変更。名前と寸法の両方を入れる */
function NigeForm({ nige, done }: { nige: Nige | null; done: () => void }) {
  const { run } = useCurrentJob()
  const [name, setName] = useState(nige?.name ?? '')
  const [text, setText] = useState(nige ? fmt(nige.value) : '')
  const [error, setError] = useState<string | null>(null)
  const pre = nige ? `nige-edit-${nige.id}` : 'nige-add'

  const save = () => {
    const v = readInput(name, text)
    if (typeof v === 'string') return setError(v)
    const r = run((j) => (nige ? updateNige(j, nige.id, v.name, v.value) : addNige(j, v.name, v.value)))
    if (!r.ok) return setError(r.message)
    closeKeyboard()
    if (!nige) {
      setName('')
      setText('')
      setError(null)
    }
    done()
  }

  const fields = (
    <>
      {!nige && <span className="label">調整寸法を追加（名前と寸法）</span>}
      <div className="list-add">
        <div className="field" style={{ flex: 3, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-name`}>
            名前
          </label>
          <input
            id={`${pre}-name`}
            className={`input${error && name.trim() === '' ? ' bad' : ''}`}
            value={name}
            placeholder="例：逃げ・ほぞ"
            enterKeyHint="next"
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="field" style={{ flex: 2, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-value`}>
            寸法
          </label>
          <span className="unit-input">
            <input
              id={`${pre}-value`}
              className={`input num${error && name.trim() !== '' ? ' bad' : ''}`}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="例：1"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <span className="unit">mm</span>
          </span>
        </div>
      </div>
      {error && (
        <p className="msg err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </>
  )

  if (nige) {
    return (
      <>
        {fields}
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
  return (
    <div className="card stack">
      {fields}
      <button type="button" className="btn primary" onClick={save}>
        追加
      </button>
    </div>
  )
}

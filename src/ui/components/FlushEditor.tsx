// 設定の画面のフラッシュの一覧（仕様書 4「フラッシュ」）：名前・芯材・表面材（材料と枚数）で追加・変更、削除。
// 厚みは engine の flushBreakdown で出す。見た目・操作は材料・調整寸法と同じ（SettingsList）
import { useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { flushBreakdown, type FlushBreakdown } from '../../engine/flush'
import type { Flush, Job } from '../../engine/types'
import { addFlush, flushesUsages, removeFlushes, updateFlush } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'
import { closeKeyboard } from '../keyboard'
import { NumberField } from './NumberField'
import { SettingsList } from './SettingsList'

/** 「厚み 25（芯材15 ＋ メラミン1×2 ＋ ラワン4×2）」 */
export function flushThicknessText(b: FlushBreakdown): string {
  const words = [`芯材${fmt(b.core)}`, ...b.faces.map((f) => `${f.label}×${f.count}`)]
  return `厚み ${fmt(b.total)}（${words.join(' ＋ ')}）`
}

/** 入力中のフラッシュの内訳（engine の flushBreakdown を、仮の id で呼ぶ） */
function draftBreakdown(job: Job, core: number, faces: Flush['faces']): FlushBreakdown | null {
  return flushBreakdown({ boards: job.boards, flushes: [{ id: '__draft', name: '', core, faces }] }, '__draft')
}

export function FlushEditor() {
  const { job, run } = useCurrentJob()
  return (
    <div className="stack">
      <p className="lead" style={{ margin: 0 }}>
        芯材の両面に表面材を貼って厚みを作る部材のための登録です。部材の「材料」の欄で選べます。表面材は材料ごとに木取りし、芯材は木取りに入れません。
      </p>
      <SettingsList<Flush>
        kind="フラッシュ"
        idPrefix="flush"
        items={job.flushes}
        label={(f) => f.name}
        usage={(f) => {
          const b = flushBreakdown(job, f.id)
          const users = flushesUsages(job, [f.id]).parts
          return `${b ? flushThicknessText(b) : ''}　${users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'}`
        }}
        add={<FlushForm flush={null} done={() => {}} />}
        renderEdit={(f, done) => <FlushForm flush={f} done={done} />}
        removeWarning={(ids) => {
          const u = flushesUsages(job, ids)
          const one = ids.length > 1 ? '選んだフラッシュ' : 'このフラッシュ'
          if (u.parts.length === 0 && u.thickness.length === 0) return null
          return (
            <>
              {u.parts.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  {one}は <b>{u.parts.join('・')}</b> で使っています。削除すると、これらの部材は「材料が未設定」になります。
                </p>
              )}
              {u.thickness.length > 0 && (
                <p className="msg warn" style={{ margin: 0 }}>
                  <b>{u.thickness.join('・')}</b> の式が{one}の厚みを使っています。削除すると、その寸法は「削除した材料の厚みを使っています」のエラーになります。
                </p>
              )}
            </>
          )
        }}
        onRemove={(ids) => run((j) => removeFlushes(j, ids))}
        emptyText="フラッシュがまだありません。"
      />
    </div>
  )
}

interface FaceRow {
  key: number
  boardId: string
  count: number | null
}

/** フラッシュの追加（flush が null）・変更。名前・芯材・表面材（材料と枚数、行を足せる） */
function FlushForm({ flush, done }: { flush: Flush | null; done: () => void }) {
  const { job, run } = useCurrentJob()
  const boards = orderedBoards(job)
  const firstFaces = (): FaceRow[] =>
    flush ? flush.faces.map((f, i) => ({ key: i, ...f })) : [{ key: 0, boardId: boards[0]?.id ?? '', count: 1 }]
  const [name, setName] = useState(flush?.name ?? '')
  const [core, setCore] = useState<number | null>(flush ? flush.core : null)
  const [faces, setFaces] = useState<FaceRow[]>(firstFaces)
  const [nextKey, setNextKey] = useState(100)
  const [error, setError] = useState<string | null>(null)
  // 追加の欄は入れ直すたびに作り直して、打ちかけの数字を消す
  const [round, setRound] = useState(0)
  const pre = flush ? `flush-edit-${flush.id}` : 'flush-add'

  const setFace = (key: number, p: Partial<FaceRow>) => {
    setFaces((cur) => cur.map((f) => (f.key === key ? { ...f, ...p } : f)))
    setError(null)
  }
  const ready = core !== null && faces.length > 0 && faces.every((f) => f.count !== null && f.boardId !== '')
  const preview = draftBreakdown(
    job,
    core ?? 0,
    faces.filter((f) => f.count !== null).map((f) => ({ boardId: f.boardId, count: f.count ?? 0 })),
  )

  const save = () => {
    if (core === null) return setError('芯材の厚みを入れてください（例：15）')
    if (faces.some((f) => f.count === null)) return setError('表面材の枚数を入れてください')
    const draft = { name, core, faces: faces.map((f) => ({ boardId: f.boardId, count: f.count ?? 0 })) }
    const r = run((j) => (flush ? updateFlush(j, flush.id, draft) : addFlush(j, draft)))
    if (!r.ok) return setError(r.message)
    closeKeyboard()
    if (!flush) {
      setName('')
      setCore(null)
      setFaces(firstFaces())
      setError(null)
      setRound((n) => n + 1)
    }
    done()
  }

  const fields = (
    <>
      {!flush && <span className="label">フラッシュを追加</span>}
      <div className="list-add">
        <div className="field" style={{ flex: 2, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-name`}>
            名前
          </label>
          <input
            id={`${pre}-name`}
            className="input"
            value={name}
            placeholder="例：フラッシュ25"
            enterKeyHint="next"
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-core`}>
            芯材
          </label>
          <NumberField
            key={round}
            id={`${pre}-core`}
            allowEmpty
            placeholder="例：15"
            value={core}
            onChange={(v) => {
              setCore(v)
              setError(null)
            }}
          />
        </div>
      </div>
      <span className="label">表面材（材料と、1部材あたりの枚数）</span>
      {boards.length === 0 && <p className="msg warn" style={{ margin: 0 }}>先に「材料」を登録してください</p>}
      {faces.map((f, i) => (
        <div key={`${round}-${f.key}`} className="list-add" role="group" aria-label={`表面材${i + 1}`}>
          <select
            className="input"
            style={{ flex: 2 }}
            aria-label={`表面材${i + 1}の材料`}
            value={f.boardId}
            onChange={(e) => setFace(f.key, { boardId: e.target.value })}
          >
            {f.boardId === '' && <option value="">（材料を選ぶ）</option>}
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.material} {fmt(b.thickness)}mm
              </option>
            ))}
          </select>
          <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <NumberField
              ariaLabel={`表面材${i + 1}の枚数`}
              integer
              allowEmpty
              unit="枚"
              value={f.count}
              onChange={(v) => setFace(f.key, { count: v })}
            />
          </span>
          {faces.length > 1 && (
            <button
              type="button"
              className="btn danger"
              aria-label={`表面材${i + 1}を外す`}
              onClick={() => setFaces((cur) => cur.filter((x) => x.key !== f.key))}
            >
              外す
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => {
          const used = new Set(faces.map((f) => f.boardId))
          const b = boards.find((x) => !used.has(x.id)) ?? boards[0]
          setFaces((cur) => [...cur, { key: nextKey, boardId: b?.id ?? '', count: 1 }])
          setNextKey((n) => n + 1)
        }}
      >
        ＋ 表面材を足す
      </button>
      {preview && core !== null && <p className="thick-auto" style={{ margin: 0 }}>{flushThicknessText(preview)}</p>}
      {error && (
        <p className="msg err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </>
  )

  if (flush) {
    return (
      <>
        {fields}
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={done}>
            やめる
          </button>
          <button type="button" className="btn primary" aria-disabled={!ready} onClick={save}>
            変える
          </button>
        </div>
      </>
    )
  }
  return (
    <div className="card stack">
      {fields}
      <button type="button" className="btn primary" aria-disabled={!ready} onClick={save}>
        追加
      </button>
    </div>
  )
}

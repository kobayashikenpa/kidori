// 設定の画面のフラッシュの一覧（仕様書 4「フラッシュ」）：芯材・表面材（材料と枚数）・名前 の順で追加・変更、削除。
// 新しく登録するときの表面材は defaultFlushFaces、名前は autoFlushName（芯材・表面材についてくる。手で書き換えたらその名前）
// 厚みは engine の flushBreakdown で出す。見た目・操作は材料・調整寸法と同じ（SettingsList）
import { useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import {
  autoFlushName,
  defaultFlushFaces,
  flushBreakdown,
  flushBreakdownText,
  isAutoFlushName,
  type FlushBreakdown,
} from '../../engine/flush'
import type { Flush, Job } from '../../engine/types'
import { addFlush, flushesUsages, removeFlushes, updateFlush } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'
import { closeKeyboard } from '../keyboard'
import { NumberField } from './NumberField'
import { SettingsList } from './SettingsList'

/** 入力中のフラッシュの内訳（engine の flushBreakdown を、仮の id で呼ぶ） */
function draftBreakdown(job: Job, core: number, faces: Flush['faces']): FlushBreakdown | null {
  return flushBreakdown({ boards: job.boards, flushes: [{ id: '__draft', name: '', core, faces }] }, '__draft')
}

export function FlushEditor() {
  const { job, run } = useCurrentJob()
  return (
    <div className="stack">
      <SettingsList<Flush>
        kind="フラッシュ"
        idPrefix="flush"
        items={job.flushes}
        label={(f) => f.name}
        usage={(f) => {
          const b = flushBreakdown(job, f.id)
          const users = flushesUsages(job, [f.id]).parts
          return `${b ? `厚み ${flushBreakdownText(b)}` : ''}　${users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'}`
        }}
        warning={(f) => ((flushBreakdown(job, f.id)?.faces.length ?? 0) === 0 ? '表面材がありません（編集で選んでください）' : null)}
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

/** フラッシュの追加（flush が null）・変更。芯材・表面材（材料と枚数、行を足せる）・名前 */
function FlushForm({ flush, done }: { flush: Flush | null; done: () => void }) {
  const { job, run } = useCurrentJob()
  const boards = orderedBoards(job)
  const firstFaces = (): FaceRow[] => {
    if (flush) return flush.faces.map((f, i) => ({ key: i, ...f }))
    const init = defaultFlushFaces(job)
    return init.length > 0 ? init.map((f, i) => ({ key: i, ...f })) : [{ key: 0, boardId: boards[0]?.id ?? '', count: 1 }]
  }
  const [name, setName] = useState(flush?.name ?? '')
  // 名前が芯材・表面材についてくるか（新しく登録するとき、または自動の名前のフラッシュを編集するとき。手で書き換えたら外す）
  const [nameAuto, setNameAuto] = useState(flush ? isAutoFlushName(flush.name) : true)
  const takenNames = job.flushes.filter((f) => f.id !== flush?.id).map((f) => f.name)
  const autoName = (c: number | null, fs: FaceRow[]): string => {
    if (c === null) return ''
    const b = draftBreakdown(job, c, fs.filter((f) => f.count !== null).map((f) => ({ boardId: f.boardId, count: f.count ?? 0 })))
    return b ? autoFlushName(b.total, takenNames) : ''
  }
  /** 芯材・表面材を変えたとき：自動の名前ならついていく */
  const follow = (c: number | null, fs: FaceRow[]) => {
    if (nameAuto) setName(autoName(c, fs))
  }
  const [core, setCore] = useState<number | null>(flush ? flush.core : null)
  const [faces, setFaces] = useState<FaceRow[]>(firstFaces)
  const [nextKey, setNextKey] = useState(100)
  const [error, setError] = useState<string | null>(null)
  // 追加の欄は入れ直すたびに作り直して、打ちかけの数字を消す
  const [round, setRound] = useState(0)
  const pre = flush ? `flush-edit-${flush.id}` : 'flush-add'

  const changeFaces = (next: FaceRow[]) => {
    setFaces(next)
    follow(core, next)
    setError(null)
  }
  const setFace = (key: number, p: Partial<FaceRow>) => changeFaces(faces.map((f) => (f.key === key ? { ...f, ...p } : f)))
  const ready = core !== null && faces.length > 0 && faces.every((f) => f.count !== null && f.boardId !== '')
  const preview = draftBreakdown(
    job,
    core ?? 0,
    faces.filter((f) => f.count !== null).map((f) => ({ boardId: f.boardId, count: f.count ?? 0 })),
  )

  const save = () => {
    if (core === null) return setError('芯材の厚みを入れてください（例：15）')
    if (faces.some((f) => f.count === null)) return setError('表面材の枚数を入れてください')
    const draft = { name: name.trim() === '' ? autoName(core, faces) : name, core, faces: faces.map((f) => ({ boardId: f.boardId, count: f.count ?? 0 })) }
    const r = run((j) => (flush ? updateFlush(j, flush.id, draft) : addFlush(j, draft)))
    if (!r.ok) return setError(r.message)
    closeKeyboard()
    if (!flush) {
      setName('')
      setNameAuto(true)
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
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-core`}>
            芯材の厚み
          </label>
          <NumberField
            key={round}
            id={`${pre}-core`}
            allowEmpty
            placeholder="例：15"
            value={core}
            onChange={(v) => {
              setCore(v)
              follow(v, faces)
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
              onClick={() => changeFaces(faces.filter((x) => x.key !== f.key))}
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
          changeFaces([...faces, { key: nextKey, boardId: b?.id ?? '', count: 1 }])
          setNextKey((n) => n + 1)
        }}
      >
        ＋ 表面材を足す
      </button>
      {preview && core !== null && <p className="thick-auto" style={{ margin: 0 }}>厚み {flushBreakdownText(preview)}</p>}
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor={`${pre}-name`}>
          名前
        </label>
        <input
          id={`${pre}-name`}
          className="input"
          value={name}
          placeholder={autoName(core, faces) || '芯材を入れると自動で入ります'}
          enterKeyHint="done"
          onChange={(e) => {
            // 手で書き換えたらその名前を使う。空にしたら自動の名前に戻す（登録のとき自動の名前を入れる）
            const v = e.target.value
            setNameAuto(v.trim() === '')
            setName(v)
            setError(null)
          }}
        />
      </div>
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

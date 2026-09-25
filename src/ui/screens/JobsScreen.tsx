// 仕事の画面（U-02）。保存した仕事の一覧・新しく作る・開く・名前を変える・コピー・削除（画面の中で確認）
import { useState, type FormEvent } from 'react'
import { bookshelfJob } from '../../engine/fixtures/bookshelf'
import type { Job } from '../../engine/types'
import { copyJob, createJob, renameJob } from '../../store/jobs'
import { useJobStore } from '../../store/useJobStore'

/** 更新日の表示（例：2026/9/25 14:05）。読めない日時なら空 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

/** 新しい順（更新日の新しいものが上） */
function byUpdatedDesc(a: Job, b: Job): number {
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
}

/** 一覧の1件で、いま何をしているか */
type Mode = { kind: 'rename'; jobId: string } | { kind: 'delete'; jobId: string } | null

export function JobsScreen({ onOpened }: { onOpened: () => void }) {
  const { state, addJob, openJob, removeJob, runOn } = useJobStore()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [renameText, setRenameText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const jobs = [...state.jobs].sort(byUpdatedDesc)
  const sampleId = bookshelfJob().id
  const hasSample = state.jobs.some((j) => j.id === sampleId)

  const reset = () => {
    setMode(null)
    setError(null)
    setNotice(null)
  }

  const open = (id: string) => {
    openJob(id)
    onOpened()
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    const job = createJob(newName)
    addJob(job, true)
    setCreating(false)
    setNewName('')
    onOpened()
  }

  const addSample = () => {
    const t = new Date().toISOString()
    addJob({ ...bookshelfJob(), createdAt: t, updatedAt: t }, true)
    onOpened()
  }

  const startRename = (job: Job) => {
    reset()
    setRenameText(job.name)
    setMode({ kind: 'rename', jobId: job.id })
  }

  const submitRename = (e: FormEvent, jobId: string) => {
    e.preventDefault()
    const r = runOn(jobId, (j) => renameJob(j, renameText))
    if (!r.ok) {
      setError(r.message)
      return
    }
    reset()
  }

  const copy = (job: Job) => {
    reset()
    const c = copyJob(
      job,
      state.jobs.map((j) => j.name),
    )
    addJob(c, false)
    setNotice(`「${c.name}」を作りました。一番上に出ています`)
  }

  const remove = (job: Job) => {
    removeJob(job.id)
    reset()
    setNotice(`「${job.name}」を消しました`)
  }

  return (
    <section>
      <h2>仕事</h2>
      <p className="lead">仕事はこのスマホの中に保存されます。家具1台（1件の注文）を1つの仕事にします。</p>

      {creating ? (
        <form className="card stack" onSubmit={create}>
          <div className="field">
            <label className="label" htmlFor="new-job-name">
              新しい仕事の名前
            </label>
            <input
              id="new-job-name"
              className="input"
              value={newName}
              placeholder="例：食器棚 W1200"
              autoFocus
              enterKeyHint="done"
              onChange={(e) => setNewName(e.target.value)}
            />
            <span className="hint">あとで変えられます。空欄なら「名前のない仕事」になります</span>
          </div>
          <div className="sheet-foot">
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              やめる
            </button>
            <button type="submit" className="btn primary">
              作って開く
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn primary wide"
          onClick={() => {
            reset()
            setCreating(true)
          }}
        >
          ＋ 新しい仕事を作る
        </button>
      )}

      {notice && <p className="msg ok banner">{notice}</p>}

      <h3>保存した仕事（{jobs.length}件）</h3>
      {jobs.length === 0 && <p className="lead">保存した仕事はありません。</p>}
      <div className="stack">
        {jobs.map((job) => {
          const isOpen = job.id === state.currentJobId
          const pieces = job.parts.reduce((n, p) => n + (Number.isFinite(p.quantity) ? p.quantity : 0), 0)
          const renaming = mode?.kind === 'rename' && mode.jobId === job.id
          const deleting = mode?.kind === 'delete' && mode.jobId === job.id
          return (
            <div key={job.id} className={`card job-item${isOpen ? ' open' : ''}`}>
              <div className="job-head">
                <span className="job-name">{job.name}</span>
                {isOpen && <span className="chip ok">開いている</span>}
              </div>
              <div className="lead" style={{ margin: 0 }}>
                部材 {job.parts.length}種類（計 {pieces}枚）・板 {job.boards.length}
              </div>
              <div className="lead" style={{ margin: 0 }}>
                更新 {formatDate(job.updatedAt)}
              </div>

              {renaming ? (
                <form className="stack" onSubmit={(e) => submitRename(e, job.id)}>
                  <div className="field">
                    <label className="label" htmlFor={`rename-${job.id}`}>
                      新しい名前
                    </label>
                    <input
                      id={`rename-${job.id}`}
                      className={`input${error ? ' bad' : ''}`}
                      value={renameText}
                      autoFocus
                      enterKeyHint="done"
                      onChange={(e) => {
                        setRenameText(e.target.value)
                        setError(null)
                      }}
                    />
                  </div>
                  {error && <p className="msg err">{error}</p>}
                  <div className="sheet-foot">
                    <button type="button" className="btn" onClick={reset}>
                      やめる
                    </button>
                    <button type="submit" className="btn primary">
                      名前を決める
                    </button>
                  </div>
                </form>
              ) : deleting ? (
                <div className="stack confirm-box" role="alert">
                  <p style={{ margin: 0 }}>
                    「{job.name}」を消しますか？{isOpen && 'いま開いている仕事です。'}部材と板の入力もすべて消えます。
                    <strong>元に戻せません。</strong>
                  </p>
                  <div className="sheet-foot">
                    <button type="button" className="btn" onClick={reset}>
                      やめる
                    </button>
                    <button type="button" className="btn danger solid" onClick={() => remove(job)}>
                      消す
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="btn primary wide" onClick={() => open(job.id)}>
                    {isOpen ? '続きを開く' : '開く'}
                  </button>
                  <div className="job-actions">
                    <button type="button" className="btn" onClick={() => startRename(job)}>
                      名前を変える
                    </button>
                    <button type="button" className="btn" onClick={() => copy(job)}>
                      コピー
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => {
                        reset()
                        setMode({ kind: 'delete', jobId: job.id })
                      }}
                    >
                      削除
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {!hasSample && (
        <button type="button" className="btn ghost" style={{ marginTop: 16 }} onClick={addSample}>
          見本（本棚 W900）を足して開く
        </button>
      )}
    </section>
  )
}

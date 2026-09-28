// 仕事の画面（U-02）。保存した仕事の一覧・新しく作る・開く・名前を変える・コピー・削除（画面の中で確認）
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Job } from '../../engine/types'
import { copyJob, createJob, renameJob } from '../../store/jobs'
import { sampleFromTemplate } from '../../store/sample'
import { backupFileName, buildBackup } from '../../store/transfer/backup'
import { MAX_TRANSFER_SIZE, READ_FAILED } from '../../store/transfer/envelope'
import { readTransferFile, type TransferRead } from '../../store/transfer/read'
import { buildShareFile, importShared, shareFileName } from '../../store/transfer/share'
import { useJobStore } from '../../store/useJobStore'
import { Help } from '../components/Help'
import { ImportDialog } from '../components/ImportDialog'
import { shareFile, shareResultMessage } from '../platform/shareSheet'

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
  const { state, addJob, addJobs, openJob, removeJob, runOn } = useJobStore()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [renameText, setRenameText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 送る・取り込むで失敗したときの知らせ（一覧の上に出す） */
  const [failure, setFailure] = useState<string | null>(null)
  /** 読めたファイル（確認を出している間だけ） */
  const [pending, setPending] = useState<Extract<TransferRead, { ok: true }> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  /** 取り込みの結果（「ファイルから取り込む」のすぐ下に出す） */
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const jobs = [...state.jobs].sort(byUpdatedDesc)

  const reset = () => {
    setMode(null)
    setError(null)
    setNotice(null)
    setFailure(null)
    setImportMsg(null)
  }

  const open = (id: string) => {
    openJob(id)
    onOpened()
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    // 最後に使った設定（ひな形）を引き継ぐ
    const job = createJob(newName, state.template)
    addJob(job, true)
    setCreating(false)
    setNewName('')
    onOpened()
  }

  const addSample = () => {
    addJob(sampleFromTemplate(state.template), true)
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

  /** この仕事を送る。共有シートを開けるよう、ファイルは押した操作の中で同期に作る */
  const send = (job: Job) => {
    reset()
    let file: File
    try {
      file = new File([buildShareFile(job, new Date())], shareFileName(job), { type: 'application/json' })
    } catch {
      setFailure('ファイルを作れませんでした')
      return
    }
    void shareFile(file, job.name).then((r) => {
      const m = shareResultMessage(r)
      if (r === 'saved') setNotice(m)
      else if (m) setFailure(m)
    })
  }

  /** バックアップを書き出す。送るときと同じく、ファイルは押した操作の中で同期に作る */
  const exportBackup = () => {
    reset()
    const now = new Date()
    let file: File
    try {
      file = new File([buildBackup(state, now)], backupFileName(now), { type: 'application/json' })
    } catch {
      setImportMsg({ ok: false, text: 'ファイルを作れませんでした' })
      return
    }
    void shareFile(file, 'kidori のバックアップ').then((r) => {
      const m = shareResultMessage(r)
      if (m) setImportMsg({ ok: r === 'saved', text: m })
    })
  }

  /** ファイルを選んだ：読んで確認を出す。読めなければ知らせるだけ（データに触らない） */
  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    // 同じファイルをもう一度選べるよう、値を毎回空に戻す
    input.value = ''
    if (!file) return
    reset()
    const fail = (text: string) => setImportMsg({ ok: false, text })
    if (file.size > MAX_TRANSFER_SIZE) {
      fail(READ_FAILED)
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      fail(READ_FAILED)
      return
    }
    const r = readTransferFile(text)
    if (!r.ok) fail(r.message)
    else setPending(r)
  }

  const importPending = () => {
    const r = pending
    setPending(null)
    if (!r || !state.canSave) return
    if (r.kind === 'share') {
      const job = importShared(
        r.job,
        state.jobs.map((j) => j.name),
        new Date(),
      )
      addJobs([job], true)
      onOpened()
    }
  }

  const remove = (job: Job) => {
    removeJob(job.id)
    reset()
    setNotice(`「${job.name}」を消しました`)
  }

  return (
    <section>
      <h2>
        <Help title="仕事">仕事はこのスマホの中に保存されます。家具1台（1件の注文）を1つの仕事にします。</Help>
      </h2>

      {creating ? (
        <form className="card stack" onSubmit={create}>
          <div className="field">
            <Help className="label" title="新しい仕事の名前">
              あとで変えられます。空欄なら「名前のない仕事」になります
            </Help>
            <input
              id="new-job-name"
              aria-label="新しい仕事の名前"
              className="input"
              value={newName}
              placeholder="例：食器棚 W1200"
              autoFocus
              enterKeyHint="done"
              onChange={(e) => setNewName(e.target.value)}
            />
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
      {failure && (
        <p className="msg err banner" role="alert">
          {failure}
        </p>
      )}

      <h3>保存した仕事（{jobs.length}件）</h3>
      {jobs.length === 0 && (
        <p className="lead">
          まだ仕事がありません。上の「＋ 新しい仕事を作る」から始めてください。
        </p>
      )}
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
                部材 {job.parts.length}種類（計 {pieces}枚）・材料 {job.boards.length}
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
                    「{job.name}」を消しますか？{isOpen && 'いま開いている仕事です。'}部材と材料の入力もすべて消えます。
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
                  <button type="button" className="btn wide" onClick={() => send(job)}>
                    この仕事を送る
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="stack" style={{ marginTop: 24 }}>
        <button type="button" className="btn wide" onClick={exportBackup}>
          バックアップを書き出す
        </button>
        <button type="button" className="btn wide" onClick={() => fileInput.current?.click()}>
          ファイルから取り込む
        </button>
        {/* accept は付けない（iPhone で .json が選べないことがあるため。中身で判断する） */}
        <input
          ref={fileInput}
          type="file"
          aria-label="取り込むファイル"
          style={{ display: 'none' }}
          onChange={(e) => void pickFile(e)}
        />
        {importMsg && (
          <p className={`msg ${importMsg.ok ? 'ok' : 'err'}`} role={importMsg.ok ? 'status' : 'alert'}>
            {importMsg.text}
          </p>
        )}
        <Help className="lead" title="バックアップと取り込み">
          バックアップは、全部の仕事を1つのファイルにします（新しいスマホに移すときなど）。「ファイルから取り込む」では、送られてきた仕事のファイルやバックアップのファイルを選びます。今の仕事は変わらず、新しい仕事として足されます
        </Help>
      </div>

      {pending && (
        <ImportDialog read={pending} canSave={state.canSave} onImport={importPending} onCancel={() => setPending(null)} />
      )}

      <div className="stack" style={{ marginTop: 24 }}>
        <button type="button" className="btn ghost" onClick={addSample}>
          見本（本棚 W900）を追加
        </button>
        <Help className="lead" title="見本について">
          使い方を試したいときだけ使ってください（今の設定で作ります。なくても困りません。あとで削除できます）
        </Help>
      </div>
    </section>
  )
}

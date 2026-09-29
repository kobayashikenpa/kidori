// 設定の画面の材料グループの一覧（第2.5版。仕様書 4「材料と材料グループ」・architecture.md 17.10）。
// コードの名前は Flush のまま（画面の言葉だけ「材料グループ」「中身」。17章の対応表）。
// 追加のときは初めの形（フラッシュ／ベタ／空）を選び、中身は engine の defaultGroupFaces、名前は autoGroupName
// （autoName の間は中身についてくる。手で書き換えたら外す）。厚み・重ね切りの判定は engine（flushBreakdown・canStack）
import { useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { canStack } from '../../engine/packing/stack'
import {
  autoGroupName,
  defaultFlushStack,
  defaultGroupFaces,
  flushBreakdown,
  flushBreakdownText,
  type FlushBreakdown,
} from '../../engine/flush'
import type { Flush, GroupForm, Job } from '../../engine/types'
import { addFlush, flushesUsages, newId, removeFlushes, updateFlush, type FlushDraft } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { closeKeyboard } from '../keyboard'
import { materialLabel, materialRuns } from '../materials'
import { NumberField } from './NumberField'
import { Segmented } from './Segmented'
import { SettingsList } from './SettingsList'

const FORM_OPTIONS: { value: GroupForm; label: string }[] = [
  { value: 'flush', label: 'フラッシュ' },
  { value: 'beta', label: 'ベタ' },
  { value: 'empty', label: '空' },
]

export function FlushEditor() {
  const { job, run } = useCurrentJob()
  return (
    <div className="stack">
      <SettingsList<Flush>
        kind="材料グループ"
        idPrefix="flush"
        items={job.flushes}
        label={(f) => f.name}
        usage={(f) => {
          const b = flushBreakdown(job, f.id)
          const users = flushesUsages(job, [f.id]).parts
          return `${b ? `厚み ${flushBreakdownText(b)}` : ''}${f.stack ? '　重ね切り' : ''}　${users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'}`
        }}
        warning={(f) => ((flushBreakdown(job, f.id)?.faces.length ?? 0) === 0 ? '中身がありません（編集で選んでください）' : null)}
        add={<FlushForm flush={null} done={() => {}} />}
        renderEdit={(f, done) => <FlushForm flush={f} done={done} />}
        removeWarning={(ids) => {
          const u = flushesUsages(job, ids)
          const one = ids.length > 1 ? '選んだ材料グループ' : 'この材料グループ'
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
        emptyText="材料グループがまだありません。"
      />
    </div>
  )
}

/** 中身の1行。boardId が null の行は空欄（材料をまだ選んでいない）。count が null は打ちかけ */
interface FaceRow {
  key: number
  boardId: string | null
  count: number | null
}

/** 中身の欄 → engine に渡す形（空欄の行は外し、打ちかけの枚数は 0 として見る） */
function toFaces(rows: readonly FaceRow[]): Flush['faces'] {
  return rows.flatMap((r) => (r.boardId === null ? [] : [{ boardId: r.boardId, count: r.count ?? 0 }]))
}

/** 入力中の材料グループの内訳（engine の flushBreakdown を、仮の id で呼ぶ） */
function draftBreakdown(job: Job, rows: readonly FaceRow[]): FlushBreakdown | null {
  return flushBreakdown({ boards: job.boards, flushes: [{ id: '__draft', name: '', faces: toFaces(rows) }] }, '__draft')
}

interface FormProps {
  /** 変える材料グループ。null なら追加 */
  flush: Flush | null
  /** 保存したら保存した材料グループの id、やめたら null */
  done: (savedId: string | null) => void
  /** 部材の編集の上に重ねて開くとき（MaterialEditSheet）：追加でも「やめる」「追加」を下に並べる */
  overlay?: boolean
}

/**
 * 材料グループの追加（flush が null）・変更。初めの形（追加のときだけ）・中身（材料 × 枚数）・厚み・名前・重ねて切る。
 * 設定の画面と、部材の編集の上に重ねて開く編集（MaterialEditSheet）で使う
 */
export function FlushForm({ flush, done, overlay = false }: FormProps) {
  const { job, run } = useCurrentJob()
  const boards = orderedBoards(job)
  const noCutBoards = boards.filter((b) => b.noCut === true)
  const cutRuns = materialRuns(boards.filter((b) => b.noCut !== true))
  const rowsOf = (form: GroupForm): FaceRow[] => defaultGroupFaces(job, form).map((f, i) => ({ key: i, ...f }))

  const [form, setForm] = useState<GroupForm>(flush?.form ?? 'flush')
  const [rows, setRows] = useState<FaceRow[]>(() => (flush ? flush.faces.map((f, i) => ({ key: i, ...f })) : rowsOf('flush')))
  const [nextKey, setNextKey] = useState(100)
  const takenNames = job.flushes.filter((f) => f.id !== flush?.id).map((f) => f.name)
  const autoName = (fm: GroupForm, rs: readonly FaceRow[]): string =>
    autoGroupName(fm, draftBreakdown(job, rs)?.total ?? 0, takenNames)
  // 名前が中身についてくるか（追加のとき、または自動の名前の材料グループ。手で書き換えたら外す）
  const [nameAuto, setNameAuto] = useState(flush ? flush.autoName === true : true)
  const [name, setName] = useState(flush?.name ?? '')
  // 新しい材料グループは、重ねられる中身なら初期オン（defaultFlushStack）。変更のときは保存した値
  const [stack, setStack] = useState(() => (flush ? flush.stack === true : defaultFlushStack(toFaces(rows), job.boards)))
  // 利用者がチェックを押したか（押していない新しい材料グループは、中身が重ねられるようになったらオンにする）
  const [stackTouched, setStackTouched] = useState(flush !== null)
  const [error, setError] = useState<string | null>(null)
  // 追加の欄は入れ直すたびに作り直して、打ちかけの数字を消す
  const [round, setRound] = useState(0)
  const pre = flush ? `flush-edit-${flush.id}` : overlay ? 'flush-new' : 'flush-add'

  const stackable = (rs: readonly FaceRow[]) => canStack({ faces: toFaces(rs) }, job.boards)
  const change = (next: FaceRow[], fm: GroupForm = form, touched = stackTouched) => {
    setRows(next)
    if (!stackable(next)) setStack(false)
    else if (!touched) setStack(defaultFlushStack(toFaces(next), job.boards))
    if (nameAuto) setName(autoName(fm, next))
    setError(null)
  }
  const setRow = (key: number, p: Partial<FaceRow>) => change(rows.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const chooseForm = (fm: GroupForm) => {
    setForm(fm)
    setStackTouched(false)
    change(rowsOf(fm), fm, false)
  }

  const preview = draftBreakdown(job, rows)
  const shownName = nameAuto && name.trim() === '' ? autoName(form, rows) : name
  const ready = rows.length > 0 && rows.every((r) => r.boardId !== null && r.count !== null && r.count >= 1)

  const save = () => {
    const draft: FlushDraft = {
      name: nameAuto || name.trim() === '' ? autoName(form, rows) : name,
      // 空欄の行は '' で渡し、store の検査の文言（中身の材料を選んでください）で断る
      faces: rows.map((r) => ({ boardId: r.boardId ?? '', count: r.count ?? 0 })),
      form,
      ...(nameAuto || name.trim() === '' ? { autoName: true as const } : {}),
      ...(stack && stackable(rows) ? { stack: true as const } : {}),
    }
    const id = flush?.id ?? newId('flush')
    const r = run((j) => (flush ? updateFlush(j, flush.id, draft) : addFlush(j, draft, id)))
    if (!r.ok) return setError(r.message)
    closeKeyboard()
    if (!flush && !overlay) {
      setForm('flush')
      const init = rowsOf('flush')
      setRows(init)
      setName('')
      setNameAuto(true)
      setStack(defaultFlushStack(toFaces(init), job.boards))
      setStackTouched(false)
      setError(null)
      setRound((n) => n + 1)
    }
    done(id)
  }

  const fields = (
    <>
      {!flush && !overlay && <span className="label">材料グループを追加</span>}
      {!flush && (
        <div className="field" style={{ margin: 0 }}>
          <span className="label">初めの形</span>
          <Segmented<GroupForm> ariaLabel="初めの形" value={form} options={FORM_OPTIONS} onChange={chooseForm} />
        </div>
      )}
      <span className="label">中身（材料と、1部材あたりの枚数）</span>
      {boards.length === 0 && (
        <p className="msg warn" style={{ margin: 0 }}>
          先に「材料」を登録してください
        </p>
      )}
      {rows.length === 0 && (
        <p className="lead" style={{ margin: 0 }}>
          中身がありません。「＋ 中身を足す」で材料を選んでください
        </p>
      )}
      {rows.map((r, i) => {
        const others = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.boardId))
        return (
          <div key={`${round}-${r.key}`} className="list-add" role="group" aria-label={`中身${i + 1}`}>
            <select
              className="input"
              style={{ flex: 2, minWidth: 0 }}
              aria-label={`中身${i + 1}の材料`}
              aria-invalid={r.boardId === null}
              value={r.boardId ?? ''}
              onChange={(e) => setRow(r.key, { boardId: e.target.value === '' ? null : e.target.value })}
            >
              {r.boardId === null && <option value="">（材料を選ぶ）</option>}
              {noCutBoards.length > 0 && (
                <optgroup label="木取りしない">
                  {noCutBoards.map((b) => (
                    <option key={b.id} value={b.id} disabled={others.has(b.id)}>
                      {materialLabel(b)}
                    </option>
                  ))}
                </optgroup>
              )}
              {cutRuns.map((g) => (
                <optgroup key={`${g.name}-${g.boards[0].id}`} label={`木取りする：${g.name}`}>
                  {g.boards.map((b) => (
                    <option key={b.id} value={b.id} disabled={others.has(b.id)}>
                      {materialLabel(b)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>
              <NumberField
                ariaLabel={`中身${i + 1}の枚数`}
                integer
                allowEmpty
                unit="枚"
                value={r.count}
                onChange={(v) => setRow(r.key, { count: v })}
              />
            </span>
            <button
              type="button"
              className="btn danger"
              aria-label={`中身${i + 1}を削除`}
              onClick={() => change(rows.filter((x) => x.key !== r.key))}
            >
              削除
            </button>
          </div>
        )
      })}
      {rows.some((r) => r.boardId === null) && (
        <p className="msg warn" style={{ margin: 0 }}>
          空欄の行の材料を選んでください（選ばないと{flush ? '変えられません' : '追加できません'}）
        </p>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => {
          change([...rows, { key: nextKey, boardId: null, count: 1 }])
          setNextKey((n) => n + 1)
        }}
      >
        ＋ 中身を足す
      </button>
      {preview && (
        <p className="thick-auto" style={{ margin: 0 }}>
          厚み {flushBreakdownText(preview)}
        </p>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={stack}
        aria-disabled={!stackable(rows)}
        aria-describedby={stackable(rows) ? undefined : `${pre}-stack-why`}
        className={`opt-check${stack ? ' on' : ''}`}
        onClick={() => {
          if (!stackable(rows)) return
          setStack((v) => !v)
          setStackTouched(true)
          setError(null)
        }}
      >
        <span className="check-box" aria-hidden="true">
          {stack ? '✓' : ''}
        </span>
        <span>重ねて切る（2枚重ね）</span>
      </button>
      {!stackable(rows) && (
        <p id={`${pre}-stack-why`} className="lead" style={{ margin: 0 }}>
          木取りする中身が2種類で、枚数が同じときに選べます
        </p>
      )}
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor={`${pre}-name`}>
          名前
        </label>
        <input
          id={`${pre}-name`}
          className="input"
          value={shownName}
          placeholder={autoName(form, rows)}
          enterKeyHint="done"
          onChange={(e) => {
            // 手で書き換えたらその名前を使う（自動の名前を外す）。空にしたら自動の名前に戻す
            const v = e.target.value
            setNameAuto(v.trim() === '')
            setName(v)
            setError(null)
          }}
        />
        {nameAuto && <span className="hint">自動の名前です。中身を変えるとついてきます</span>}
      </div>
      {error && (
        <p className="msg err" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </>
  )

  if (flush || overlay) {
    return (
      <>
        {fields}
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={() => done(null)}>
            やめる
          </button>
          <button type="button" className="btn primary" aria-disabled={!ready} onClick={save}>
            {flush ? '変える' : '追加'}
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

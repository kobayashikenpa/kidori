// 部材の編集シート：名前・板・W/H/D・枚数・厚みの寸法・木目・切り代・メモ
import { useMemo, useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { computeDimensions } from '../../engine/dimensions'
import { computeFinished } from '../../engine/dimensions/finished'
import { thicknessChoice } from '../../engine/dimensions/thickness'
import { validatePartForSave } from '../../engine/dimensions/validate'
import { AXES, type Axis, type Part, type PartGrain } from '../../engine/types'
import { addPart, boardLabel, newPart, partsReferencing, removePart, updatePart } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'
import { FormulaInput } from './FormulaInput'
import { NumberField } from './NumberField'
import { Segmented } from './Segmented'
import { Sheet } from './Sheet'

interface Props {
  /** 編集する部材。null なら新しく足す */
  part: Part | null
  onClose: () => void
}

export function PartEditor({ part, onClose }: Props) {
  const { job, run } = useCurrentJob()
  const [draft, setDraft] = useState<Part>(() => part ?? newPart({ boardId: orderedBoards(job)[0]?.id ?? null }))
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const patch = (p: Partial<Part>) => {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }

  // 入力中の内容で寸法を計算し直す（計算は engine に任せる）
  const draftJob = useMemo(
    () => ({ ...job, parts: part ? job.parts.map((p) => (p.id === part.id ? draft : p)) : [...job.parts, draft] }),
    [job, part, draft],
  )
  const allDims = useMemo(() => computeDimensions(draftJob), [draftJob])
  const dims = allDims.parts.find((p) => p.partId === draft.id)!
  const finishedOf = (partId: string) => allDims.parts.find((p) => p.partId === partId)?.finished ?? null
  // ボタンの並びを開いている欄（1つだけ）
  const [padAxis, setPadAxis] = useState<Axis | null>(null)
  const faces = dims.faceAxes
  const board = job.boards.find((b) => b.id === draft.boardId) ?? null
  const cutting = draft.quantity > 0
  // 厚みの寸法：ふだんは「厚み：W（自動）」と表示だけ。決めきれない・手で選んでいる・同じ寸法が無いときだけ選ぶ欄（仕様書 5.3）
  const choice = useMemo(
    () => thicknessChoice(draft, board, computeFinished(draftJob).get(draft.id)?.finished ?? {}),
    [draft, board, draftJob],
  )
  // 厚みの寸法が変わって、木目が面でない軸のままなら「どちらでもよい」とみなす（暫定：未決事項 15）
  const grain: PartGrain = draft.grain !== 'any' && faces && !faces.includes(draft.grain) ? 'any' : draft.grain

  // 保存できない理由（厚みの寸法が材料の厚みと合わない。仕様書 5.3）。判定は engine に任せる
  const blockers = useMemo(() => validatePartForSave(job, { ...draft, grain }), [job, draft, grain])

  const save = () => {
    if (blockers.length > 0) {
      setError(`厚みの寸法が材料の厚みと合わないので${part ? '保存' : '追加'}できません。寸法か厚みを直してください`)
      return
    }
    const next = { ...draft, grain }
    const r = run((j) => (part ? updatePart(j, part.id, next) : addPart(j, next)))
    if (r.ok) onClose()
    else setError(r.message)
  }
  const remove = () => {
    if (!part) return
    const r = run((j) => removePart(j, part.id))
    if (r.ok) onClose()
    else setError(r.message)
  }
  const referencing = part ? partsReferencing(job, part.id) : []

  return (
    <Sheet title={part ? `部材の編集：${part.name}` : '部材を追加'} onClose={onClose}>
      <div className="field">
        <label className="label" htmlFor="part-name">
          名前
        </label>
        <input
          id="part-name"
          className="input"
          value={draft.name}
          placeholder="例：側板"
          onChange={(e) => patch({ name: e.target.value })}
        />
        <span className="hint">式の中で「{draft.name.trim() || '名前'}.W」のように使います。同じ名前は付けられません</span>
      </div>

      <div className="field">
        <label className="label" htmlFor="part-qty">
          枚数
        </label>
        <NumberField
          id="part-qty"
          integer
          unit="枚"
          value={draft.quantity}
          onChange={(v) => v !== null && patch({ quantity: v })}
        />
        {!cutting && <span className="hint">枚数0は切り出さない、寸法だけの行です（例：全体）</span>}
      </div>

      {cutting && (
        <div className="field">
          <label className="label" htmlFor="part-board">
            材料
          </label>
          <select
            id="part-board"
            className="input"
            value={draft.boardId ?? ''}
            onChange={(e) => patch({ boardId: e.target.value || null })}
          >
            <option value="">（材料が未設定）</option>
            {orderedBoards(job).map((b) => (
              <option key={b.id} value={b.id}>
                {boardLabel(b)}
              </option>
            ))}
          </select>
          {!board && <p className="msg warn">材料が未設定です。木取りの計算には材料が必要です</p>}
        </div>
      )}

      {AXES.map((axis) => (
        <FormulaInput
          key={axis}
          axis={axis}
          value={draft.expr[axis]}
          job={job}
          boardId={draft.boardId}
          onChange={(v) => patch({ expr: { ...draft.expr, [axis]: v } })}
          parts={job.parts.filter((p) => p.id !== draft.id)}
          finished={dims.finished?.[axis] ?? null}
          finishedOf={finishedOf}
          // 厚みが合わないエラーは「厚み」の欄の下に出すので、式の下（2行の枠）には式のエラーだけを出す
          errors={dims.errors.filter((e) => e.axis === axis && e.kind !== 'thicknessMismatch')}
          open={padAxis === axis}
          onOpenChange={(o) => setPadAxis(o ? axis : padAxis === axis ? null : padAxis)}
        />
      ))}

      {cutting && (
        <>
          <div className="field">
            {choice.showSelector && <span className="label">厚み</span>}
            {!choice.showSelector ? (
              <p className="thick-auto" style={{ margin: 0 }}>
                {board ? `厚み：${choice.autoAxis ?? '—'}（自動）` : '厚み：材料を選ぶと自動で決まります'}
              </p>
            ) : (
              <Segmented<Axis | 'auto'>
                ariaLabel="厚み"
                value={draft.thicknessAxis ?? 'auto'}
                options={[
                  { value: 'auto', label: dims.thicknessAuto && dims.thicknessAxis ? `自動（${dims.thicknessAxis}）` : '自動' },
                  ...AXES.map((a) => ({ value: a, label: a })),
                ]}
                onChange={(v) => patch({ thicknessAxis: v === 'auto' ? null : v })}
              />
            )}
            <span className="hint">
              {choice.showSelector && choice.ambiguous
                ? `材料の厚みと同じ寸法が ${choice.candidates.join('・')} にあります。どれが厚みか選んでください`
                : 'W・H・D のうち、材料の厚みにあたる寸法です'}
            </span>
            {blockers.length > 0 && (
              <div className="part-errors" role="alert">
                {blockers.map((m) => (
                  <p key={m} className="msg err" style={{ margin: 0 }}>
                    {m}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <span className="label">木目</span>
            {faces ? (
              <Segmented<PartGrain>
                ariaLabel="木目"
                value={grain}
                options={[
                  ...faces.map((a) => ({ value: a, label: `${a}方向` })),
                  { value: 'any', label: 'どちらでもよい' },
                ]}
                onChange={(v) => patch({ grain: v })}
              />
            ) : (
              <span className="hint">厚みが決まると選べます</span>
            )}
          </div>

          <div className="field">
            <label className="label" htmlFor="part-allowance">
              切り代
            </label>
            <NumberField
              id="part-allowance"
              allowEmpty
              placeholder={`空欄＝初期値 ${fmt(job.settings.allowance)}`}
              value={draft.allowance}
              onChange={(v) => patch({ allowance: v })}
            />
          </div>
        </>
      )}

      <div className="field">
        <label className="label" htmlFor="part-memo">
          メモ（任意）
        </label>
        <textarea
          id="part-memo"
          className="input memo-input"
          rows={3}
          value={draft.memo}
          placeholder="例：切り出したあとに穴あけ"
          onChange={(e) => patch({ memo: e.target.value })}
        />
        <span className="hint">寸法表にも出ます</span>
      </div>

      {error && <p className="msg err">{error}</p>}
      {!error && blockers.length > 0 && <p className="msg err">厚みの寸法が材料の厚みと合わないうちは{part ? '保存' : '追加'}できません</p>}
      <div className="sheet-foot">
        <button type="button" className="btn primary" aria-disabled={blockers.length > 0} onClick={save}>
          {part ? '保存する' : '追加する'}
        </button>
      </div>

      {part &&
        (confirming ? (
          <div className="card stack" role="alertdialog" aria-label="部材の削除の確認">
            {referencing.length > 0 && (
              <p className="msg warn" style={{ margin: 0 }}>
                <b>{referencing.join('・')}</b> の式がこの部材の寸法を使っています。削除すると、その式はエラーになります。
              </p>
            )}
            <p style={{ margin: 0 }}>「{part.name}」を削除しますか？</p>
            <div className="sheet-foot">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                やめる
              </button>
              <button type="button" className="btn danger solid" onClick={remove}>
                削除する
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn danger wide" onClick={() => setConfirming(true)}>
            この部材を削除
          </button>
        ))}
    </Sheet>
  )
}

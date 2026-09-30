// 部材の編集シート：名前・板・W/H/D・枚数・厚みの寸法・木目・切り代・メモ
import { useEffect, useMemo, useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { boardTokenLabel } from '../../engine/defaults'
import { swapThicknessRef } from '../../engine/formula/usages'
import { computeDimensions } from '../../engine/dimensions'
import { flushBreakdown, flushBreakdownText, flushThickness, partIsNoCut, partThicknessSource } from '../../engine/flush'
import { partAllowance } from '../../engine/dimensions/cutSize'
import { computeFinished } from '../../engine/dimensions/finished'
import { thicknessChoice } from '../../engine/dimensions/thickness'
import { validatePartForSave } from '../../engine/dimensions/validate'
import { AXES, type Axis, type Part, type PartGrain } from '../../engine/types'
import { addPart, boardLabel, newPart, partsReferencing, removePart, updatePart } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'
import { materialLabel, materialName, materialNameGroups } from '../materials'
import { FormulaInput } from './FormulaInput'
import { Help } from './Help'
import { MaterialEditSheet, type MaterialEditTarget } from './MaterialEditSheet'
import { NumberField } from './NumberField'
import { Segmented } from './Segmented'
import { Sheet } from './Sheet'

/** 材料の欄の1段目で選んでいるもの（材料名、または材料グループ。何も選んでいなければ null） */
type MaterialPick = { kind: 'name'; name: string } | { kind: 'group' } | null

interface Props {
  /** 編集する部材。null なら新しく足す */
  part: Part | null
  onClose: () => void
}

export function PartEditor({ part, onClose }: Props) {
  const { job, run } = useCurrentJob()
  // 新しい部材の材料は、並びの最初の木取りする材料（木取りしない材料（芯材など）を初めから選ばないように）
  const [draft, setDraft] = useState<Part>(() => {
    if (part) return part
    const boards = orderedBoards(job)
    return newPart({ boardId: (boards.find((b) => b.noCut !== true) ?? boards[0])?.id ?? null })
  })
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const patch = (p: Partial<Part>) => {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }
  // 材料を変えたときの厚みの置き換えの知らせ（仕様書 5.4・architecture.md 15.7）。before は置き換える前の下書きの式（元に戻す用）
  const [swapped, setSwapped] = useState<{ message: string; before: Part['expr'] } | null>(null)
  // 材料の欄の1段目で選んでいるもの（材料名、または材料グループ）。画面の中だけの状態で、開いたときは下書きの材料から決める（第2.7版）
  const pickFromDraft = (): MaterialPick => {
    if (draft.flushId !== undefined) return { kind: 'group' }
    const b = job.boards.find((x) => x.id === draft.boardId)
    return b ? { kind: 'name', name: materialName(b) } : null
  }
  const [pickState, setPick] = useState<MaterialPick>(pickFromDraft)
  // 部材の編集の上に重ねて開いている、設定の材料・材料グループの編集（architecture.md 17.10）
  const [materialEdit, setMaterialEdit] = useState<MaterialEditTarget | null>(null)
  // 「＋ 材料グループを作る」で作った材料グループ。仕事に入ったあと（次の描画）で部材の下書きに選ぶ
  const [createdGroup, setCreatedGroup] = useState<string | null>(null)
  // 材料・材料グループの表示名（式の {t:…} の名前と同じ）
  const thicknessName = (id: string | null): string => {
    const f = job.flushes.find((x) => x.id === id)
    if (f) return f.name
    const b = job.boards.find((x) => x.id === id)
    return b ? boardTokenLabel(b) : ''
  }
  // 材料の欄を変える。下書きの式の前の材料の厚みを新しい材料の厚みに置き換える（計算は engine の swapThicknessRef）
  const changeMaterial = (p: Pick<Part, 'boardId' | 'flushId'>) => {
    const from = draft.flushId ?? draft.boardId
    const to = p.flushId ?? p.boardId
    const r = swapThicknessRef(draft.expr, from, to)
    patch({ ...p, expr: r.expr })
    setSwapped(
      r.axes.length > 0
        ? { message: `${r.axes.join('・')} の式の${thicknessName(from)} を${thicknessName(to)} に置き換えました`, before: draft.expr }
        : null,
    )
  }

  useEffect(() => {
    if (createdGroup === null || !job.flushes.some((f) => f.id === createdGroup)) return
    setCreatedGroup(null)
    // changeMaterial を通すので、式の厚みの置き換えと知らせも出る
    changeMaterial({ flushId: createdGroup, boardId: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdGroup, job])

  // 材料の欄の材料名ごとのまとまり（名前は最初に出てくる順、厚みは小さい順）
  const nameGroups = materialNameGroups(orderedBoards(job))
  // 選んでいた材料名が無くなったら（「編集」で材料名を直したときなど）、下書きの今の材料から決め直す
  const pick: MaterialPick =
    pickState?.kind === 'name' && !nameGroups.some((g) => g.name === pickState.name) ? pickFromDraft() : pickState

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
  // 厚みの判定に使う厚み：材料の厚み、またはフラッシュの合計の厚み（engine の partThicknessSource）
  const board = partThicknessSource(job, draft)
  const flush = draft.flushId !== undefined ? flushBreakdown(job, draft.flushId) : null
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
    setSwapped(null)
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
    <>
      <Sheet title={part ? `部材の編集：${part.name}` : '部材を追加'} onClose={onClose}>
        <div className="field">
          <Help className="label" title="名前">
            式の中で「{draft.name.trim() || '名前'}.W」のように使います。同じ名前は付けられません
          </Help>
          <input
            id="part-name"
            aria-label="名前"
            className="input"
            value={draft.name}
            placeholder="例：側板"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>

        <div className="field">
          <Help className="label" title="枚数">
            枚数0は切り出さない、寸法だけの行です（例：全体）
          </Help>
          <NumberField
            ariaLabel="枚数"
            integer
            unit="枚"
            value={draft.quantity}
            onChange={(v) => v !== null && patch({ quantity: v })}
          />
        </div>

        {cutting && (
          <div className="field">
            <Help className="label" title="材料">
              材料名と厚みで選びます。材料グループを選ぶと、木取りする中身ごとに木取りします（木取りしない材料は入れません）。「編集」で設定の材料・材料グループを直せます
            </Help>
            <div className="list-add" style={{ alignItems: 'center' }}>
              <span className="mat-current" style={{ flex: 1, minWidth: 0 }}>
                材料：
                {draft.flushId !== undefined
                  ? (() => {
                      const f = job.flushes.find((x) => x.id === draft.flushId)
                      return f ? `${f.name}（厚み ${fmt(flushThickness(f, job.boards))}mm）` : '未設定'
                    })()
                  : (() => {
                      const cur = job.boards.find((x) => x.id === draft.boardId)
                      return cur ? materialLabel(cur) : '未設定'
                    })()}
              </span>
              <button
                type="button"
                className="btn"
                aria-label="選んでいる材料を設定で編集"
                aria-disabled={draft.flushId === undefined && draft.boardId === null}
                onClick={() => {
                  if (draft.flushId !== undefined) setMaterialEdit({ kind: 'group', id: draft.flushId })
                  else if (draft.boardId !== null) setMaterialEdit({ kind: 'board', id: draft.boardId })
                }}
              >
                編集
              </button>
            </div>
            <div className="mat-chips" role="group" aria-label="材料名">
              {nameGroups.map((g) => (
                <button
                  key={g.name}
                  type="button"
                  className="mat-chip name"
                  aria-pressed={pick?.kind === 'name' && pick.name === g.name}
                  onClick={() => setPick({ kind: 'name', name: g.name })}
                >
                  {g.name}
                </button>
              ))}
              <button
                type="button"
                className="mat-chip name"
                aria-pressed={pick?.kind === 'group'}
                onClick={() => setPick({ kind: 'group' })}
              >
                材料グループ
              </button>
            </div>
            {pick?.kind === 'name' && (
              <div className="mat-chips mat-step2" role="group" aria-label={`${pick.name} の厚み`}>
                {(nameGroups.find((g) => g.name === pick.name)?.boards ?? []).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`mat-chip${b.noCut === true ? ' nocut' : ''}`}
                    aria-pressed={draft.flushId === undefined && draft.boardId === b.id}
                    aria-label={b.noCut === true ? `${boardLabel(b)} 木取りしない` : boardLabel(b)}
                    onClick={() => changeMaterial({ boardId: b.id, flushId: undefined })}
                  >
                    <span className="mat-thick">{fmt(b.thickness)}</span>
                    {b.noCut === true && <span className="mat-nocut">木取りしない</span>}
                  </button>
                ))}
              </div>
            )}
            {pick?.kind === 'group' && (
              <div className="mat-chips mat-step2" role="group" aria-label="材料グループ">
                {job.flushes.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="mat-chip name"
                    aria-pressed={draft.flushId === f.id}
                    onClick={() => changeMaterial({ flushId: f.id, boardId: null })}
                  >
                    {f.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="mat-chip name add-group"
                  onClick={() => setMaterialEdit({ kind: 'newGroup' })}
                >
                  ＋ 材料グループを作る
                </button>
              </div>
            )}
            {flush && <span className="hint">厚み {flushBreakdownText(flush)}</span>}
            {!board && <p className="msg warn">材料が未設定です。木取りの計算には材料が必要です</p>}
            {partIsNoCut(job, draft) && <p className="msg warn">木取りしない材料なので、木取りの計算には入りません</p>}
            {swapped && (
              <div className="swap-note" role="status">
                <p className="msg ok" style={{ margin: 0 }}>
                  {swapped.message}
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    patch({ expr: swapped.before })
                    setSwapped(null)
                  }}
                >
                  元に戻す
                </button>
              </div>
            )}
          </div>
        )}

        {AXES.map((axis) => (
          <FormulaInput
            key={axis}
            axis={axis}
            value={draft.expr[axis]}
            job={job}
            thicknessId={draft.flushId ?? draft.boardId}
            onChange={(v) => {
              setSwapped(null)
              patch({ expr: { ...draft.expr, [axis]: v } })
            }}
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
              {choice.showSelector && (
                <Help className="label" title="厚み">
                  W・H・D のうち、材料の厚みにあたる寸法です
                </Help>
              )}
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
              {choice.showSelector && choice.ambiguous && (
                <span className="hint">
                  材料の厚みと同じ寸法が {choice.candidates.join('・')} にあります。どれが厚みか選んでください
                </span>
              )}
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
                ariaLabel="切り代"
                allowEmpty
                placeholder={`空欄＝${draft.flushId !== undefined ? '初期値 ' : ''}${fmt(partAllowance({ allowance: null, flushId: draft.flushId }, job.settings))}`}
                value={draft.allowance}
                onChange={(v) => patch({ allowance: v })}
              />
              <span className="hint">材料グループの部材だけに足します（材料の部材は、入れたときだけ足します）</span>
            </div>
          </>
        )}

        <div className="field">
          <Help className="label" title="メモ（任意）">
            寸法表にも出ます
          </Help>
          <textarea
            id="part-memo"
            aria-label="メモ"
            className="input memo-input"
            rows={3}
            value={draft.memo}
            placeholder="例：切り出したあとに穴あけ"
            onChange={(e) => patch({ memo: e.target.value })}
          />
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
      {materialEdit && (
        <MaterialEditSheet
          target={materialEdit}
          onClose={(id) => {
            setMaterialEdit(null)
            if (id !== null) setCreatedGroup(id)
          }}
        />
      )}
    </>
  )
}

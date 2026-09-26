// W・H・D の式の入力。<input> を使わず式を表示する枠にするので、押しても電話のキーボードは出ない。
// 枠を押すとボタンの並びが開き、カーソルが末尾に来る。部材の寸法・材料の厚み・逃げ・数字・演算子のボタンだけで式を作る。
// 材料の厚みは {t:材料のid}、逃げは {n:逃げのid} として式に入れ、画面では ラワン4mm・逃げ1mm と見せる
import { useState, type PointerEvent } from 'react'
import { boardTokenLabel, nigeName } from '../../engine/defaults'
import { formulaLabels } from '../../engine/formula/display'
import { formulaUnits } from '../../engine/formula/units'
import { AXES, type Axis, type DimensionError, type Job, type Part } from '../../engine/types'
import { fmt } from '../format'
import { clearAll, deleteBefore, insertAt, moveLeft, moveRight, type Edit, type PadKey } from '../formulaEdit'

const AXIS_NAME: Record<Axis, string> = { W: '幅', H: '高さ', D: '奥行き' }

/** 数字・演算子のボタン（表示, 入れる文字）。× ÷ − は * / - として式に入れる */
const KEYS: [string, PadKey][] = [
  ['7', '7'], ['8', '8'], ['9', '9'], ['+', '+'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['×', '*'],
  ['0', '0'], ['.', '.'], ['(', '('], ['÷', '/'],
]

interface Props {
  axis: Axis
  value: string
  onChange: (v: string) => void
  /** 表示名（ラワン4mm・逃げ1mm など）を作るための材料と設定 */
  job: Pick<Job, 'boards' | 'settings'>
  /** 参照ボタンに出す部材（編集中の部材自身は除く） */
  parts: Part[]
  /** 参照ボタンに添える、部材ごとの仕上がり寸法 */
  finishedOf: (partId: string) => Record<Axis, number> | null
  /** この欄の仕上がり寸法（計算できなければ null） */
  finished: number | null
  /** この欄の式のエラー */
  errors: DimensionError[]
  /** ボタンの並びを開いているか */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 式の中で色つきの塊として見せる単位 */
const CHIP_CLASS: Partial<Record<string, string>> = {
  partRef: 'chip-ref',
  thickness: 'chip-thick',
  nige: 'chip-nige',
  bad: 'chip-bad',
}

export function FormulaInput({ axis, value, onChange, job, parts, finishedOf, finished, errors, open, onOpenChange }: Props) {
  const id = `expr-${axis}`
  const units = formulaUnits(value)
  const labels = formulaLabels(value, job)
  // カーソル＝単位の番号（0〜単位の数）
  const [cursorRaw, setCursor] = useState(units.length)
  const cursor = Math.min(cursorRaw, units.length)

  const apply = (edit: (text: string, at: number) => Edit) => {
    const e = edit(value, cursor)
    setCursor(e.cursor)
    if (e.text !== value) onChange(e.text)
  }
  const put = (piece: string) => apply((t, at) => insertAt(t, at, piece))

  // ボタンを押しても枠から注目が外れないようにする（画面が跳ねないように）
  const keep = (e: PointerEvent) => e.preventDefault()

  const openAtEnd = () => {
    setCursor(units.length)
    onOpenChange(true)
  }

  const spoken = labels.length > 0 ? labels.join(' ') : '空'

  return (
    <div className="field">
      <span className="label" aria-hidden="true">
        {axis}（{AXIS_NAME[axis]}）
        {finished !== null && <span className="expr-result num"> 仕上がり {fmt(finished)}</span>}
      </span>
      <button
        type="button"
        className={`expr-box${open ? ' active' : ''}${errors.length > 0 ? ' bad' : ''}`}
        aria-describedby={errors.length > 0 ? `${id}-err` : undefined}
        aria-expanded={open}
        aria-controls={`${id}-pad`}
        aria-label={`${axis} の式：${spoken}。押すとボタンで入力できます`}
        onClick={openAtEnd}
      >
        {units.length === 0 && !open && <span className="expr-placeholder">押して数値または式を入力</span>}
        {units.map((u, i) => {
          const gap = i > 0 && u.start > units[i - 1].end
          const chip = CHIP_CLASS[u.kind]
          return (
            <span key={`${u.start}-${u.text}`} className="expr-unit-wrap">
              {open && cursor === i && <span className="caret" aria-hidden="true" />}
              <span className={`expr-unit num${gap ? ' gap' : ''}${chip ? ` chip ${chip}` : ''}`}>{labels[i]}</span>
            </span>
          )
        })}
        {open && cursor === units.length && <span className="caret" aria-hidden="true" />}
      </button>
      {errors.length > 0 && (
        <p className="msg err" id={`${id}-err`} role="alert">
          {errors.map((e) => e.message).join('。')}
        </p>
      )}

      {open && (
        <div className="pad" id={`${id}-pad`}>
          {parts.length > 0 && (
            <div className="pad-refs" aria-label="部材の寸法">
              {parts.map((p) => {
                const f = finishedOf(p.id)
                return AXES.map((a) => (
                  <button
                    key={`${p.id}-${a}`}
                    type="button"
                    className="pad-ref"
                    onPointerDown={keep}
                    onClick={() => put(`${p.name}.${a}`)}
                  >
                    <span className="ref-name">
                      {p.name}.{a}
                    </span>
                    <span className="ref-val num">{f ? fmt(f[a]) : '―'}</span>
                  </button>
                ))
              })}
            </div>
          )}
          {job.boards.length > 0 && (
            <div className="pad-group">
              <span className="pad-title">材料の厚み</span>
              <div className="pad-chips">
                {job.boards.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="pad-chip chip-thick"
                    onPointerDown={keep}
                    onClick={() => put(`{t:${b.id}}`)}
                  >
                    {boardTokenLabel(b)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {job.settings.nige.length > 0 && (
            <div className="pad-group">
              <span className="pad-title">逃げ</span>
              <div className="pad-chips">
                {job.settings.nige.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="pad-chip chip-nige"
                    onPointerDown={keep}
                    onClick={() => put(`{n:${n.id}}`)}
                  >
                    {nigeName(n.value)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="pad-keys">
            {KEYS.map(([label, key]) => (
              <button key={label} type="button" className="pad-key num" onPointerDown={keep} onClick={() => put(key)}>
                {label}
              </button>
            ))}
            <button type="button" className="pad-key num" onPointerDown={keep} onClick={() => put(')')}>
              )
            </button>
            <button
              type="button"
              className="pad-key"
              aria-label="カーソルを左へ"
              onPointerDown={keep}
              onClick={() => setCursor(moveLeft(value, cursor))}
            >
              ◀
            </button>
            <button
              type="button"
              className="pad-key"
              aria-label="カーソルを右へ"
              onPointerDown={keep}
              onClick={() => setCursor(moveRight(value, cursor))}
            >
              ▶
            </button>
            <button type="button" className="pad-key" onPointerDown={keep} onClick={() => apply(deleteBefore)}>
              1字消す
            </button>
            <button type="button" className="pad-key span2" onPointerDown={keep} onClick={() => apply(clearAll)}>
              全部消す
            </button>
            <button type="button" className="pad-key done span2" onPointerDown={keep} onClick={() => onOpenChange(false)}>
              完了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

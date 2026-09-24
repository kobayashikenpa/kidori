// W・H・D の式の入力欄。欄の下に、登録済みの部材の寸法ボタンと、数字・演算子のボタンを並べる。
// ボタンだけで式を作れる。キーボードでも打てる
import { useRef, type PointerEvent } from 'react'
import { AXES, type Axis, type DimensionError, type Part } from '../../engine/types'
import { fmt } from '../format'
import { backspace, insertKey, insertRef, type Edit, type PadKey } from '../formulaEdit'

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

export function FormulaInput({ axis, value, onChange, parts, finishedOf, finished, errors, open, onOpenChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  // 最後のカーソル位置。欄の外のボタンを押したときも、ここに入れる
  const caret = useRef<number | null>(null)
  const id = `expr-${axis}`

  const remember = () => {
    const el = inputRef.current
    if (el && document.activeElement === el) caret.current = el.selectionStart
  }

  const apply = (edit: (text: string, at: number) => Edit) => {
    const at = Math.min(caret.current ?? value.length, value.length)
    const e = edit(value, at)
    caret.current = e.caret
    onChange(e.text)
    const el = inputRef.current
    if (el && document.activeElement === el) {
      requestAnimationFrame(() => el.setSelectionRange(e.caret, e.caret))
    }
  }

  // ボタンを押してもキーボードが出ない・入力欄のフォーカスが外れないようにする
  const keep = (e: PointerEvent) => e.preventDefault()

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {axis}（{AXIS_NAME[axis]}）
        {finished !== null && <span className="expr-result num"> 仕上がり {fmt(finished)}</span>}
      </label>
      <div className="expr-row">
        <input
          ref={inputRef}
          id={id}
          className={`input num${errors.length > 0 ? ' bad' : ''}`}
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length > 0 ? `${id}-err` : undefined}
          value={value}
          placeholder="数値または式"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onFocus={() => onOpenChange(true)}
          onChange={(e) => {
            caret.current = e.target.selectionStart
            onChange(e.target.value)
          }}
          onSelect={remember}
          onKeyUp={remember}
          onClick={remember}
        />
        <button
          type="button"
          className="btn pad-toggle"
          aria-expanded={open}
          aria-controls={`${id}-pad`}
          onClick={() => onOpenChange(!open)}
        >
          ボタン
        </button>
      </div>
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
                    onClick={() => apply((t, at) => insertRef(t, at, `${p.name}.${a}`))}
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
          <div className="pad-keys">
            {KEYS.map(([label, key]) => (
              <button
                key={label}
                type="button"
                className="pad-key num"
                onPointerDown={keep}
                onClick={() => apply((t, at) => insertKey(t, at, key))}
              >
                {label}
              </button>
            ))}
            <button type="button" className="pad-key num" onPointerDown={keep} onClick={() => apply((t, at) => insertKey(t, at, ')'))}>
              )
            </button>
            <button type="button" className="pad-key" onPointerDown={keep} onClick={() => apply(backspace)}>
              1字消す
            </button>
            <button
              type="button"
              className="pad-key"
              onPointerDown={keep}
              onClick={() => apply(() => ({ text: '', caret: 0 }))}
            >
              全部消す
            </button>
            <button type="button" className="pad-key done" onPointerDown={keep} onClick={() => onOpenChange(false)}>
              完了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

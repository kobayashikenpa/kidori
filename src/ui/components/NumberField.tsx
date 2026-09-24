// 数の入力欄。打っている途中の文字はそのまま持ち、読める数になったら知らせる
import { useState } from 'react'
import { fmt, parseNum } from '../format'

interface Props {
  value: number | null
  /** 読める数（空欄を許すときは null も）になるたびに呼ぶ */
  onChange: (v: number | null) => void
  /** 空欄を許すか（許すと null を渡す） */
  allowEmpty?: boolean
  /** 整数だけか */
  integer?: boolean
  unit?: string
  placeholder?: string
  id?: string
  ariaLabel?: string
}

export function NumberField({ value, onChange, allowEmpty, integer, unit = 'mm', placeholder, id, ariaLabel }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const shown = editing ?? (value === null ? '' : fmt(value))
  const parsed = parseNum(shown)
  const bad =
    parsed === null
      ? !allowEmpty
      : Number.isNaN(parsed) || parsed < 0 || (integer === true && !Number.isInteger(parsed))

  return (
    <span className="unit-input">
      <input
        id={id}
        aria-label={ariaLabel}
        className={`input num${bad ? ' bad' : ''}`}
        inputMode={integer ? 'numeric' : 'decimal'}
        enterKeyHint="done"
        value={shown}
        placeholder={placeholder}
        onFocus={() => setEditing(value === null ? '' : fmt(value))}
        onBlur={() => setEditing(null)}
        onChange={(e) => {
          const text = e.target.value
          setEditing(text)
          const v = parseNum(text)
          if (v === null) {
            if (allowEmpty) onChange(null)
            return
          }
          if (Number.isNaN(v) || v < 0 || (integer && !Number.isInteger(v))) return
          onChange(v)
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  )
}

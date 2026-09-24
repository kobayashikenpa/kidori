// W・H・D の入力欄（数値または式）。仕上がり寸法も横に示す
import type { Axis, Part } from '../../engine/types'
import { fmt } from '../format'

const AXIS_NAME: Record<Axis, string> = { W: '幅', H: '高さ', D: '奥行き' }

interface Props {
  axis: Axis
  value: string
  onChange: (v: string) => void
  /** 参照ボタンに出す部材（編集中の部材自身は除く） */
  parts: Part[]
  /** 仕上がり寸法（計算できなければ null） */
  finished: number | null
}

export function ExprField({ axis, value, onChange, finished }: Props) {
  const id = `expr-${axis}`
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {axis}（{AXIS_NAME[axis]}）
        {finished !== null && <span className="expr-result num"> 仕上がり {fmt(finished)}</span>}
      </label>
      <input
        id={id}
        className="input num"
        value={value}
        placeholder="数値または式"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

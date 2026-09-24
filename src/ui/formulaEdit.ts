// 式の入力欄をボタンで編集するための文字操作（画面の部品から使う。計算はしない）
import { parseRefText, splitChunks } from '../engine/formula/tokenize'

export interface Edit {
  text: string
  /** 編集後のカーソル位置 */
  caret: number
}

export type PadKey = '+' | '-' | '*' | '/' | '(' | ')' | '.' | `${number}`

const OPERATORS = new Set(['+', '-', '*', '/'])

/** カーソル位置に文字を入れる。演算子は前後に空白を入れて読みやすくする */
export function insertKey(text: string, caret: number, key: PadKey): Edit {
  const left = text.slice(0, caret)
  const right = text.slice(caret)
  let ins: string = key
  if (OPERATORS.has(key)) {
    ins = (left === '' || /\s$/.test(left) || left.endsWith('(') ? '' : ' ') + key + (/^\s/.test(right) ? '' : ' ')
  }
  return { text: left + ins + right, caret: caret + ins.length }
}

/** カーソル位置に参照（例：全体.W）を入れる。前の文字とくっつかないように空白をはさむ */
export function insertRef(text: string, caret: number, ref: string): Edit {
  const left = text.slice(0, caret)
  const right = text.slice(caret)
  const needSpace = left !== '' && !/[\s(+\-*/]$/.test(left)
  const ins = (needSpace ? ' ' : '') + ref
  return { text: left + ins + right, caret: caret + ins.length }
}

/** カーソルの前を1字消す。直前が参照（全体.W など）なら参照ごと消す。間の空白もいっしょに消す */
export function backspace(text: string, caret: number): Edit {
  let i = caret
  while (i > 0 && /\s/.test(text[i - 1])) i--
  if (i === 0) return { text: text.slice(caret), caret: 0 }
  const chunk = splitChunks(text).find((c) => !('type' in c) && c.end === i)
  const start = chunk && !('type' in chunk) && parseRefText(chunk.text) ? chunk.start : i - 1
  return { text: text.slice(0, start) + text.slice(caret), caret: start }
}

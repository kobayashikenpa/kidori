// 式を「カーソルで動く単位」に分ける（ボタンだけの入力と、式の表示で使う）
import { isBraceText, normalizeFormulaText, parseBraceText, parseRefText, splitChunks } from './tokenize'

export type UnitKind =
  | 'digit' // 数字1文字・小数点1文字
  | 'op' // + - * /
  | 'paren' // ( )
  | 'partRef' // 部材の参照（全体.W）
  | 'thickness' // 材料の厚み {t:…}
  | 'nige' // 逃げ {n:…}
  | 'bad' // 読めない文字のかたまり（古いデータ用）

export interface Unit {
  kind: UnitKind
  /** 保存した文字列の中の開始位置 */
  start: number
  /** 保存した文字列の中の終了位置（この位置の文字は含まない） */
  end: number
  /** 保存した文字列のこの単位の部分（expr.slice(start, end)） */
  text: string
}

const DIGITS_RE = /^[\d.]+$/

/**
 * 式を単位に分ける。空白は単位にしない。
 * 部材の参照・材料の厚み・逃げは1つの単位（1つの塊として移動・削除する）、数字と小数点は1文字ずつ
 */
export function formulaUnits(expr: string): Unit[] {
  const out: Unit[] = []
  for (const item of splitChunks(expr)) {
    const { start, end } = item
    const text = expr.slice(start, end)
    if ('type' in item) {
      out.push({ kind: item.type === '(' || item.type === ')' ? 'paren' : 'op', start, end, text })
      continue
    }
    if (isBraceText(text)) {
      const b = parseBraceText(text)
      out.push({ kind: b ? b.kind : 'bad', start, end, text })
      continue
    }
    if (parseRefText(text)) {
      out.push({ kind: 'partRef', start, end, text })
      continue
    }
    if (DIGITS_RE.test(normalizeFormulaText(text))) {
      for (let i = start; i < end; i++) out.push({ kind: 'digit', start: i, end: i + 1, text: expr[i] })
      continue
    }
    out.push({ kind: 'bad', start, end, text })
  }
  return out
}

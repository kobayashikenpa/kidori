// 式の構文解析：字句 → 構文木（AST）。普通の四則演算の優先順位。先頭や ( の直後などの - は符号
import type { Axis } from '../types'
import { tokenize, type Operator, type Token } from './tokenize'

/** 式の構文木 */
export type Expr =
  | { type: 'number'; value: number }
  | { type: 'ref'; part: string; axis: Axis }
  | { type: 'neg'; arg: Expr }
  | { type: 'binary'; op: Operator; left: Expr; right: Expr }

/** 式の計算で起こるエラー */
export interface FormulaError {
  kind: 'syntax' | 'unknownRef' | 'divideByZero'
  /** 画面にそのまま出せる日本語 */
  message: string
  /** unknownRef のときの部材名 */
  refs?: string[]
  /** syntax のとき、式の中の問題の位置 */
  start?: number
  end?: number
}

export type ParseResult = { ok: true; ast: Expr } | { ok: false; error: FormulaError }

class SyntaxFailure {
  readonly error: FormulaError
  constructor(error: FormulaError) {
    this.error = error
  }
}

/** 式の文字列を構文木にする。例外は投げず、結果の型で返す */
export function parse(expr: string): ParseResult {
  const t = tokenize(expr)
  if (!t.ok) return { ok: false, error: { kind: 'syntax', message: t.message, start: t.start, end: t.end } }
  if (t.tokens.length === 0) return { ok: false, error: { kind: 'syntax', message: '式が空です' } }

  const tokens = t.tokens
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const fail = (message: string, tok: Token | undefined): never => {
    throw new SyntaxFailure({
      kind: 'syntax',
      message,
      start: tok?.start ?? expr.length,
      end: tok?.end ?? expr.length,
    })
  }

  // 式 = 項 { (+|-) 項 }
  function parseSum(): Expr {
    let left = parseProduct()
    for (let tok = peek(); tok && (tok.type === '+' || tok.type === '-'); tok = peek()) {
      pos++
      left = { type: 'binary', op: tok.type, left, right: parseProduct() }
    }
    return left
  }

  // 項 = 因子 { (*|/) 因子 }
  function parseProduct(): Expr {
    let left = parseFactor()
    for (let tok = peek(); tok && (tok.type === '*' || tok.type === '/'); tok = peek()) {
      pos++
      left = { type: 'binary', op: tok.type, left, right: parseFactor() }
    }
    return left
  }

  // 因子 = - 因子 | 数値 | 参照 | ( 式 )
  function parseFactor(): Expr {
    const tok = peek()
    if (!tok) return fail('式が途中で終わっています', tok)
    switch (tok.type) {
      case '-':
        pos++
        return { type: 'neg', arg: parseFactor() }
      case 'number':
        pos++
        return { type: 'number', value: tok.value }
      case 'ref':
        pos++
        return { type: 'ref', part: tok.part, axis: tok.axis }
      case '(': {
        pos++
        if (peek()?.type === ')') return fail('( ) の中が空です', peek())
        const inner = parseSum()
        if (peek()?.type !== ')') return fail('「)」が足りません', peek())
        pos++
        return inner
      }
      default:
        return fail(`「${expr.slice(tok.start, tok.end)}」の位置がおかしいです`, tok)
    }
  }

  try {
    const ast = parseSum()
    const rest = peek()
    if (rest) {
      if (rest.type === ')') fail('「(」が足りません', rest)
      fail(`「${expr.slice(rest.start, rest.end)}」の前に + - * / が必要です`, rest)
    }
    return { ok: true, ast }
  } catch (e) {
    if (e instanceof SyntaxFailure) return { ok: false, error: e.error }
    throw e
  }
}

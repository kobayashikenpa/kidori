// 式の字句の切り出し：数値・参照（部材名.W/H/D）・記号（+ - * / ( )）
import { AXES, type Axis } from '../types'

export type Operator = '+' | '-' | '*' | '/'

interface TokenBase {
  /** 式の中の開始位置（文字の番号、0 から） */
  start: number
  /** 式の中の終了位置（この位置の文字は含まない） */
  end: number
}

export type Token =
  | (TokenBase & { type: 'number'; value: number })
  | (TokenBase & { type: 'ref'; part: string; axis: Axis })
  | (TokenBase & { type: Operator | '(' | ')' })

export type TokenizeResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; message: string; start: number; end: number }

/** 部材名に使えない記号（式の区切りになる文字） */
const SYMBOLS = ['+', '-', '*', '/', '(', ')'] as const
const SYMBOL_SET: ReadonlySet<string> = new Set(SYMBOLS)

const NUMBER_RE = /^\d+(?:\.\d+)?$/

function isSpace(ch: string): boolean {
  return /\s/.test(ch)
}

/** 記号と空白で区切った「ひとかたまり」の文字列。記号・空白以外が続く部分 */
export interface Chunk {
  text: string
  start: number
  end: number
}

/**
 * 式を、記号・空白・ひとかたまりの文字列に分ける。失敗しない。
 * 字句の切り出しと、部材名のつけ替え（rename）の両方で使う
 */
export function splitChunks(expr: string): (Token | Chunk)[] {
  const order: (Token | Chunk)[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (isSpace(ch)) {
      i++
      continue
    }
    if (SYMBOL_SET.has(ch)) {
      order.push({ type: ch as Operator | '(' | ')', start: i, end: i + 1 })
      i++
      continue
    }
    const start = i
    while (i < expr.length && !isSpace(expr[i]) && !SYMBOL_SET.has(expr[i])) i++
    order.push({ text: expr.slice(start, i), start, end: i })
  }
  return order
}

/**
 * ひとかたまりの文字列を、参照「部材名.W/H/D」として読む。読めなければ null。
 * 部材名には . を使えないので、. はちょうど1つ。その前が部材名、後ろが軸
 */
export function parseRefText(text: string): { part: string; axis: Axis } | null {
  const dot = text.indexOf('.')
  if (dot <= 0 || dot !== text.lastIndexOf('.')) return null
  const part = text.slice(0, dot)
  const axis = text.slice(dot + 1)
  if (!(AXES as readonly string[]).includes(axis)) return null
  return { part, axis: axis as Axis }
}

/** 式を字句に分ける。例外は投げず、読めない部分があればその位置とメッセージを返す */
export function tokenize(expr: string): TokenizeResult {
  const tokens: Token[] = []
  for (const item of splitChunks(expr)) {
    if ('type' in item) {
      tokens.push(item)
      continue
    }
    const { text, start, end } = item
    if (NUMBER_RE.test(text)) {
      tokens.push({ type: 'number', value: Number(text), start, end })
      continue
    }
    const ref = parseRefText(text)
    if (ref) {
      tokens.push({ type: 'ref', part: ref.part, axis: ref.axis, start, end })
      continue
    }
    return { ok: false, message: `「${text}」が読めません（数値か「部材名.W」「部材名.H」「部材名.D」で書いてください）`, start, end }
  }
  return { ok: true, tokens }
}

/**
 * 部材名に使えるかを調べる。使えれば null、使えなければ理由（日本語）を返す。
 * 式の区切りになる記号（+ - * / ( ) .）と空白は使えない。otherNames と同じ名前も使えない
 */
export function validatePartName(name: string, otherNames: readonly string[] = []): string | null {
  if (name.length === 0) return '部材名を入れてください'
  if ([...name].some((ch) => isSpace(ch))) return '部材名に空白は使えません'
  const bad = [...name].find((ch) => SYMBOL_SET.has(ch) || ch === '.')
  if (bad !== undefined) return `部材名に「${bad}」は使えません（+ - * / ( ) . は式で使う記号のため）`
  if (otherNames.includes(name)) return `「${name}」という部材はすでにあります`
  return null
}

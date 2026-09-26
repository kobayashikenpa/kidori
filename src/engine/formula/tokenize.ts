// 式の字句の切り出し：数値・参照（部材名.W/H/D）・材料の厚み {t:板のid}・逃げ {n:逃げのid}・記号（+ - * / ( )）
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
  | (TokenBase & { type: 'thickness'; boardId: string })
  | (TokenBase & { type: 'nige'; nigeId: string })
  | (TokenBase & { type: Operator | '(' | ')' })

export type TokenizeResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; message: string; start: number; end: number }

/** 部材名に使えない記号（式の区切りになる文字） */
const SYMBOLS = ['+', '-', '*', '/', '(', ')'] as const
const SYMBOL_SET: ReadonlySet<string> = new Set(SYMBOLS)

const NUMBER_RE = /^\d+(?:\.\d+)?$/

/** 1文字をそろえたうえで { か（全角の ｛ も） */
function isOpenBrace(ch: string): boolean {
  return normalizeFormulaText(ch) === '{'
}

/** 1文字をそろえたうえで } か（全角の ｝ も） */
function isCloseBrace(ch: string): boolean {
  return normalizeFormulaText(ch) === '}'
}

function isSpace(ch: string): boolean {
  return /\s/.test(ch)
}

/**
 * 入力の揺れをそろえる：全角の数字・記号・英字を半角に（NFKC）、× ✕ を *、÷ を /、− – — を - に。
 * 長音の ー は部材名に使うため置き換えない
 */
export function normalizeFormulaText(text: string): string {
  return text.normalize('NFKC').replace(/[×✕]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-')
}

/** 1文字をそろえたうえで、式の記号（+ - * / ( )）ならその記号、でなければ null */
function symbolOf(ch: string): Operator | '(' | ')' | null {
  const n = normalizeFormulaText(ch)
  return SYMBOL_SET.has(n) ? (n as Operator | '(' | ')') : null
}

/** 記号と空白で区切った「ひとかたまり」の文字列。記号・空白以外が続く部分 */
export interface Chunk {
  text: string
  start: number
  end: number
}

/**
 * 式を、記号・空白・ひとかたまりの文字列に分ける。失敗しない。
 * 全角の記号（＋ など）も記号として扱う。位置とかたまりの文字列は入力したまま。
 * { から次の } までは、中に記号や空白があっても1つのかたまりにする（} が無ければ式の終わりまで）。
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
    const sym = symbolOf(ch)
    if (sym) {
      order.push({ type: sym, start: i, end: i + 1 })
      i++
      continue
    }
    const start = i
    if (isOpenBrace(ch)) {
      i++
      while (i < expr.length && !isCloseBrace(expr[i])) i++
      if (i < expr.length) i++
      order.push({ text: expr.slice(start, i), start, end: i })
      continue
    }
    while (i < expr.length && !isSpace(expr[i]) && !symbolOf(expr[i]) && !isOpenBrace(expr[i])) i++
    order.push({ text: expr.slice(start, i), start, end: i })
  }
  return order
}

/**
 * ひとかたまりの文字列を、参照「部材名.W/H/D」として読む。読めなければ null。
 * 部材名には . を使えないので、. はちょうど1つ。その前が部材名、後ろが軸。
 * 全角はそろえてから読むので、返す部材名はそろえた後の名前（normalizePartName と同じ形）
 */
export function parseRefText(raw: string): { part: string; axis: Axis } | null {
  const text = normalizeFormulaText(raw)
  const dot = text.indexOf('.')
  if (dot <= 0 || dot !== text.lastIndexOf('.')) return null
  const part = text.slice(0, dot)
  const axis = text.slice(dot + 1)
  if (!(AXES as readonly string[]).includes(axis)) return null
  return { part, axis: axis as Axis }
}

/** 材料の厚み・逃げのかたまりか（{ で始まるか。全角の ｛ も） */
export function isBraceText(raw: string): boolean {
  return raw.length > 0 && isOpenBrace(raw[0])
}

const BRACE_RE = /^\{([tn]):([^{}\s]+)\}$/

/**
 * かたまりの文字列を、材料の厚み {t:板のid}・逃げ {n:逃げのid} として読む。読めなければ null。
 * 全角の ｛ ｝ はそろえてから読む
 */
export function parseBraceText(raw: string): { kind: 'thickness' | 'nige'; id: string } | null {
  const m = BRACE_RE.exec(normalizeFormulaText(raw))
  if (!m) return null
  return { kind: m[1] === 't' ? 'thickness' : 'nige', id: m[2] }
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
    if (isBraceText(text)) {
      const b = parseBraceText(text)
      if (!b) {
        const closed = isCloseBrace(text[text.length - 1]) && text.length > 1
        return {
          ok: false,
          message: closed ? `読めない参照があります（「${text}」）` : `「${text}」が読めません（「}」が足りません）`,
          start,
          end,
        }
      }
      tokens.push(b.kind === 'thickness' ? { type: 'thickness', boardId: b.id, start, end } : { type: 'nige', nigeId: b.id, start, end })
      continue
    }
    const normalized = normalizeFormulaText(text)
    if (NUMBER_RE.test(normalized)) {
      tokens.push({ type: 'number', value: Number(normalized), start, end })
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

/** 部材名を、式の中の参照と比べられる形にそろえる（全角・半角の違いをなくす） */
export function normalizePartName(name: string): string {
  return normalizeFormulaText(name)
}

/**
 * 部材名に使えるかを調べる。使えれば null、使えなければ理由（日本語）を返す。
 * 式の区切りになる記号（+ - * / ( ) . { }）と空白は使えない（全角の ＋ や × ÷ − なども、式では記号になるので使えない）。
 * otherNames と同じ名前（全角・半角の違いだけのものも含む）も使えない
 */
export function validatePartName(name: string, otherNames: readonly string[] = []): string | null {
  if (name.length === 0) return '部材名を入れてください'
  if ([...name].some((ch) => isSpace(ch) || isSpace(normalizeFormulaText(ch)))) return '部材名に空白は使えません'
  const bad = [...name].find((ch) => [...normalizeFormulaText(ch)].some((n) => SYMBOL_SET.has(n) || n === '.'))
  if (bad !== undefined) return `部材名に「${bad}」は使えません（+ - * / ( ) . × ÷ は式で使う記号のため）`
  const brace = [...name].find((ch) => isOpenBrace(ch) || isCloseBrace(ch))
  if (brace !== undefined) return `部材名に「${brace}」は使えません（{ } は式で材料の厚み・調整寸法を表すため）`
  const key = normalizePartName(name)
  const same = otherNames.find((n) => normalizePartName(n) === key)
  if (same !== undefined) return `「${same}」という部材はすでにあります`
  return null
}

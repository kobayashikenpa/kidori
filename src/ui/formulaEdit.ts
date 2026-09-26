// 式をボタンだけで編集するための操作（画面の部品から使う。計算はしない）。
// カーソルは「単位の番号」（0〜単位の数。k は k 番目の単位の前）で持つ。
// 部材の参照（全体.W）・材料の厚み {t:…}・逃げ {n:…} は1つの単位なので、1回の ◀ ▶・1字消す で塊ごと動く・消える
import { formulaUnits, type Unit, type UnitKind } from '../engine/formula/units'

export interface Edit {
  text: string
  /** 編集後のカーソル（単位の番号） */
  cursor: number
}

/** 数字・小数点・演算子・括弧のボタンで入れる文字 */
export type PadKey = '+' | '-' | '*' | '/' | '(' | ')' | '.' | `${number}`

type Side = Pick<Unit, 'kind' | 'text'> | undefined

/** 2つの単位の間に空白をはさむか。数字どうしはくっつけ、( の後ろと ) の前は空けない */
function needsSpace(a: Side, b: Side): boolean {
  if (!a || !b) return false
  if (a.kind === 'digit' && b.kind === 'digit') return false
  if (a.kind === 'paren' && (a.text === '(' || a.text === '（')) return false
  if (b.kind === 'paren' && (b.text === ')' || b.text === '）')) return false
  return true
}

const endsWithSpace = (s: string) => /\s$/.test(s)
const startsWithSpace = (s: string) => /^\s/.test(s)

/** 単位の数（カーソルの右端） */
export function unitCount(text: string): number {
  return formulaUnits(text).length
}

function clamp(cursor: number, n: number): number {
  return Math.max(0, Math.min(n, Math.floor(cursor)))
}

/** カーソルを1つ左へ（塊は1回で越える） */
export function moveLeft(text: string, cursor: number): number {
  return clamp(cursor - 1, unitCount(text))
}

/** カーソルを1つ右へ（塊は1回で越える） */
export function moveRight(text: string, cursor: number): number {
  return clamp(cursor + 1, unitCount(text))
}

/**
 * カーソルの位置に1つの単位（数字1字・演算子・括弧・全体.W・{t:…}・{n:…}）を入れる。
 * 前後の単位とくっついて別の意味にならないよう、必要なら空白をはさむ（空白は計算に影響しない）
 */
export function insertAt(text: string, cursor: number, piece: string): Edit {
  const units = formulaUnits(text)
  const k = clamp(cursor, units.length)
  const pos = k < units.length ? units[k].start : text.length
  const left = text.slice(0, pos)
  const right = text.slice(pos)
  const kind: UnitKind = formulaUnits(piece)[0]?.kind ?? 'bad'
  const me = { kind, text: piece }
  const pre = !endsWithSpace(left) && needsSpace(units[k - 1], me) ? ' ' : ''
  const post = !startsWithSpace(right) && needsSpace(me, units[k]) ? ' ' : ''
  const head = left + pre + piece
  const next = head + post + right
  // 入れた単位の後ろにカーソルを置く
  const after = formulaUnits(next).filter((u) => u.end <= head.length).length
  return { text: next, cursor: after }
}

/** 数字・演算子などのボタン */
export function insertKey(text: string, cursor: number, key: PadKey): Edit {
  return insertAt(text, cursor, key)
}

/**
 * カーソルの前の単位を1つ消す（部材の参照・厚み・逃げは塊ごと）。その前の空白もいっしょに消す。
 * 消したあとで前後の単位がくっついて別の意味にならないよう、必要なら空白を1つ残す
 */
export function deleteBefore(text: string, cursor: number): Edit {
  const units = formulaUnits(text)
  const k = clamp(cursor, units.length)
  if (k === 0) return { text, cursor: 0 }
  const target = units[k - 1]
  const prev = units[k - 2]
  const from = prev ? prev.end : 0
  const left = text.slice(0, from)
  let right = text.slice(target.end)
  if (left === '') right = right.trimStart()
  const gap = !startsWithSpace(right) && needsSpace(prev, units[k]) ? ' ' : ''
  return { text: left + gap + right, cursor: k - 1 }
}

/** 全部消す */
export function clearAll(): Edit {
  return { text: '', cursor: 0 }
}

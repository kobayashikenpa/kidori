// 画面に出す数の形。寸法は小数第1位まで（.0 は付けない）
import { round1 } from '../engine/round'

export function fmt(n: number): string {
  return String(round1(n))
}

/** 入力欄の文字を数にする。全角の数字も受け付ける。空なら null、読めなければ NaN */
export function parseNum(text: string): number | null {
  const t = text.normalize('NFKC').trim()
  if (t === '') return null
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN
}

/** 歩留まり（0〜1）を「78.2%」の形にする */
export function pct(rate: number): string {
  return `${fmt(rate * 100)}%`
}

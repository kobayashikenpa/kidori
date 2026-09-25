// 切る順番：端切り → 帯を右端から切り離す → その帯を上端から片ごとに切り分ける → 細い片の幅を切り揃える
// 端切り：縦切り優先（縦長）は右の長手。横切り優先（横長）は上の長手 → 右の妻手の順（右上の角の矩を出す）
// 位置の表し方：その時点で残っている板（切る範囲）の端から測った長さ（＝切り離す片・帯の大きさ）
// - 縦の切断は「右端から」、横の切断は「上端から」（どちらの置き方でも、配置図の上で見た向き）
// 刃厚は測った側の反対側（余りの側）で消える：縦は線の左、横は線の下。
// 端切りの幅は刃厚を含む。
import { round1 } from '../round'
import type { CutDirection, CutStep, Rect } from '../types'
import type { Frame, LocalRect, RawSheet } from './guillotine'
import { trimRects } from './sheet'

type Kind = CutStep['kind']

function fmt(v: number): string {
  return String(round1(v))
}

function label(direction: CutDirection, at: number, within: Rect): string {
  if (direction === 'vertical') return `右端から ${fmt(within.x + within.w - at)}mm で縦に切る`
  return `上端から ${fmt(within.y + within.h - at)}mm で横に切る`
}

export function buildCuts(
  sheet: RawSheet,
  frame: Frame,
  board: { width: number; length: number },
  trim: number,
): CutStep[] {
  const cuts: CutStep[] = []
  const right = frame.usable.x + frame.usable.w
  const top = frame.usable.y + frame.usable.h

  const push = (direction: CutDirection, at: number, within: Rect, kind: Kind, text?: string) => {
    const a = round1(at)
    cuts.push({ no: cuts.length + 1, direction, at: a, within, kind, label: text ?? label(direction, a, within) })
  }
  /** 帯を並べる方向（p）の位置 e で縦に切る：帯を切り離す・幅を切り揃える */
  const cutP = (e: number, within: LocalRect, kind: Kind) => push('vertical', right - e, frame.toBoard(within), kind)
  /** 帯の中の方向（q）の位置 e で横に切る：帯を片に切り分ける */
  const cutQ = (e: number, within: LocalRect, kind: Kind) => push('horizontal', top - e, frame.toBoard(within), kind)

  // 端切り
  const t = fmt(trim)
  if (frame.mode === 'horizontal') {
    const [topTrim, rightTrim] = trimRects(board, trim, 'horizontal')
    if (topTrim && rightTrim) {
      push('horizontal', topTrim.y, { x: 0, y: 0, w: board.length, h: board.width }, 'trim', `端切り：上の長手を ${t}mm 落とす（横に切る）`)
      push('vertical', rightTrim.x, { x: 0, y: 0, w: board.length, h: topTrim.y }, 'trim', `端切り：右の妻手を ${t}mm 落とす（縦に切る）`)
    }
  } else {
    const [rightTrim] = trimRects(board, trim, 'vertical')
    if (rightTrim) {
      push('vertical', rightTrim.x, { x: 0, y: 0, w: board.width, h: board.length }, 'trim', `端切り：右の長手を ${t}mm 落とす（縦に切る）`)
    }
  }

  const pCap = round1(frame.pCap)
  const qCap = round1(frame.qCap)
  for (const st of sheet.strips) {
    const s = st.local
    // 1. 帯を切り離す（残りの側に何か残るときだけ）
    const sEnd = round1(s.p + s.pw)
    if (sEnd < pCap) cutP(sEnd, { p: s.p, q: 0, pw: round1(pCap - s.p), qh: qCap }, 'strip')
    // 2. 帯を上端から片ごとに切り分ける
    for (const it of st.items) {
      const qEnd = round1(it.local.q + it.local.qh)
      if (qEnd < qCap) cutQ(qEnd, { p: s.p, q: it.local.q, pw: s.pw, qh: round1(qCap - it.local.q) }, 'crosscut')
    }
    // 3. 帯より細い片の幅を切り揃える
    for (const it of st.items) {
      const pEnd = round1(it.local.p + it.local.pw)
      if (pEnd < sEnd) cutP(pEnd, { p: s.p, q: it.local.q, pw: s.pw, qh: it.local.qh }, 'rip')
    }
  }
  return cuts
}

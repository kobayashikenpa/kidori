// 切る順番：耳落とし → 帯を原点側（右端・手前）から切り離す → その帯を片ごとに切り分ける → 細い片の幅を切り揃える
// 刃厚は、縦に切るときは線の左、横に切るときは線の上（余りの側）で消える。耳落としの幅は刃厚を含む。
// 位置の表し方：縦の切断は「切る範囲の右端から」、横の切断は「切る範囲の下端から」の長さ（＝切り離す片・帯の大きさ）
import { round1 } from '../round'
import type { CutDirection, CutStep, Rect } from '../types'
import type { Frame, LocalRect, RawSheet } from './guillotine'

type Kind = CutStep['kind']

function fmt(v: number): string {
  return String(round1(v))
}

function label(direction: CutDirection, at: number, within: Rect): string {
  return direction === 'vertical'
    ? `右端から ${fmt(within.x + within.w - at)}mm で縦に切る`
    : `下端から ${fmt(at - within.y)}mm で横に切る`
}

export function buildCuts(
  sheet: RawSheet,
  frame: Frame,
  board: { width: number; length: number },
  trim: number,
): CutStep[] {
  const cuts: CutStep[] = []
  const right = frame.usable.x + frame.usable.w
  const vertical = frame.mode === 'vertical'

  const push = (direction: CutDirection, at: number, within: Rect, kind: Kind, text?: string) => {
    const a = round1(at)
    cuts.push({ no: cuts.length + 1, direction, at: a, within, kind, label: text ?? label(direction, a, within) })
  }
  /** 帯を並べる方向（p）の位置 e で切る：帯を切り離す・幅を切り揃える */
  const cutP = (e: number, within: LocalRect, kind: Kind) => {
    const r = frame.toBoard(within)
    if (vertical) push('vertical', right - e, r, kind)
    else push('horizontal', frame.usable.y + e, r, kind)
  }
  /** 帯の中の方向（q）の位置 e で切る：帯を片に切り分ける */
  const cutQ = (e: number, within: LocalRect, kind: Kind) => {
    const r = frame.toBoard(within)
    if (vertical) push('horizontal', frame.usable.y + e, r, kind)
    else push('vertical', right - e, r, kind)
  }

  if (round1(trim) > 0) {
    push(
      'vertical',
      board.width - trim,
      { x: 0, y: 0, w: board.width, h: board.length },
      'trim',
      `耳落とし：右の長辺を ${fmt(trim)}mm 落とす（縦に切る）`,
    )
  }

  const pCap = round1(frame.pCap)
  const qCap = round1(frame.qCap)
  for (const st of sheet.strips) {
    const s = st.local
    // 1. 帯を切り離す（残りの側に何か残るときだけ）
    const sEnd = round1(s.p + s.pw)
    if (sEnd < pCap) cutP(sEnd, { p: s.p, q: 0, pw: round1(pCap - s.p), qh: qCap }, 'strip')
    // 2. 帯を手前（原点側）から片ごとに切り分ける
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

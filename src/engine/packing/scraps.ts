// 端材：板の残り（帯を並べた反対側）、各帯の残りの長さ、帯より細い片の横の残り。
// 大きさは刃厚ぶんを除いたもの。幅・長さとも MIN_SCRAP 以上のものだけを、面積の大きい順に返す
import { round1 } from '../round'
import type { Rect } from '../types'
import type { Frame, LocalRect, RawSheet } from './guillotine'

/** 端材として出す最小の大きさ（mm）。幅・長さともこれ以上 */
export const MIN_SCRAP = 30

export function scrapsOf(sheet: RawSheet, frame: Frame, kerf: number): Rect[] {
  const pCap = round1(frame.pCap)
  const qCap = round1(frame.qCap)
  const local: LocalRect[] = []

  let pEnd = 0
  for (const st of sheet.strips) {
    const s = st.local
    pEnd = round1(s.p + s.pw)
    // 帯の残りの長さ
    const last = st.items[st.items.length - 1]
    const used = last ? round1(last.local.q + last.local.qh) : 0
    const q0 = round1(used + kerf)
    local.push({ p: s.p, q: q0, pw: s.pw, qh: round1(qCap - q0) })
    // 帯より細い片の横の残り
    for (const it of st.items) {
      const p0 = round1(it.local.p + it.local.pw + kerf)
      local.push({ p: p0, q: it.local.q, pw: round1(pEnd - p0), qh: it.local.qh })
    }
  }
  // 板の残り（帯を並べた反対側）
  if (sheet.strips.length > 0) {
    const p0 = round1(pEnd + kerf)
    local.push({ p: p0, q: 0, pw: round1(pCap - p0), qh: qCap })
  }

  return local
    .filter((r) => r.pw >= MIN_SCRAP && r.qh >= MIN_SCRAP)
    .map((r) => frame.toBoard(r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h || a.i - b.i)
    .map(({ r }) => r)
}

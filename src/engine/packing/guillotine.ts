// 帯詰め（ギロチンカット）の配置。
// 帯を並べる方向を p、帯の中で片を並べる方向を q とする「帯の座標」で計算し、最後に板の座標に直す。
// - 縦切り優先：帯は長辺方向の縦長。p は右端から左へ、q は手前（y=0）から奥へ
// 帯は使える範囲の原点側（右端・手前）から詰め、余りは反対側（左・奥）に残る。
import { round1 } from '../round'
import type { Placement, Rect } from '../types'
import type { Orientation, Piece } from './pieces'

export type StripMode = 'vertical' | 'horizontal'

/** 帯の座標の長方形。p・pw：帯を並べる方向の位置と大きさ、q・qh：帯の中の方向の位置と大きさ */
export interface LocalRect {
  p: number
  q: number
  pw: number
  qh: number
}

/** 帯の座標と板の座標の対応 */
export interface Frame {
  mode: StripMode
  usable: Rect
  /** 帯を並べる方向の長さ */
  pCap: number
  /** 帯の長さ */
  qCap: number
  toBoard(r: LocalRect): Rect
  /** 片の向きを帯の座標の大きさにする */
  sizes(o: Orientation): { pw: number; qh: number }
}

export function frameOf(mode: StripMode, usable: Rect): Frame {
  const right = usable.x + usable.w
  // 縦切り優先：p は右端から左へ（x）、q は手前から奥へ（y）
  return {
    mode,
    usable,
    pCap: usable.w,
    qCap: usable.h,
    toBoard: (r) => ({ x: round1(right - r.p - r.pw), y: round1(usable.y + r.q), w: r.pw, h: r.qh }),
    sizes: (o) => ({ pw: o.x, qh: o.y }),
  }
}

export interface StripItem {
  local: LocalRect
  placement: Placement
}

export interface StripLayout {
  /** 帯の座標での帯（長さは帯の端から端まで＝qCap） */
  local: LocalRect
  /** 板の座標での帯 */
  rect: Rect
  /** 手前（原点側）から詰めた順 */
  items: StripItem[]
}

export interface RawSheet {
  /** 原点側（右端・手前）から並べた順 */
  strips: StripLayout[]
}

export interface GuillotineResult {
  frame: Frame
  sheets: RawSheet[]
  /** 入る向きがなかった片（pieces.ts で除いているので通常は空） */
  unplaced: Piece[]
}

interface Cand {
  o: Orientation
  pw: number
  qh: number
}

interface WorkStrip {
  p: number
  pw: number
  /** 帯の中で使った長さ（最後の片の奥の端） */
  used: number
  items: { piece: Piece; c: Cand; q: number }[]
}

interface WorkSheet {
  strips: WorkStrip[]
  /** 最後の帯の反対側の端（帯がなければ 0） */
  pEnd: number
}

/**
 * 片を帯詰めで板に並べる。
 * 1. 帯の幅（p 方向）の大きい順 → 長さ（q 方向）の大きい順に並べる
 * 2. 開いている板の帯を先頭から見て、幅が収まり残りの長さに刃厚込みで入る最初の帯に置く
 * 3. なければ、残りの幅がある板に新しい帯を作る。それもなければ新しい板を出す
 * 計算量は 片の数 × 帯の数。片はどれも使える範囲に入る向きを1つ以上持つこと（pieces.ts で確認済み）
 */
export function packGuillotine(pieces: readonly Piece[], usable: Rect, kerf: number, mode: StripMode): GuillotineResult {
  const frame = frameOf(mode, usable)
  const pCap = round1(frame.pCap)
  const qCap = round1(frame.qCap)

  const items = pieces.map((piece, idx) => {
    const cands: Cand[] = piece.orientations.map((o) => ({ o, ...frame.sizes(o) }))
    // 並べ替えの基準にする向き：帯の中の方向に長く置く向き
    let main = cands[0]
    for (const c of cands) if (c.qh > main.qh) main = c
    return { piece, idx, tryOrder: [main, ...cands.filter((c) => c !== main)], main }
  })
  items.sort((a, b) => b.main.pw - a.main.pw || b.main.qh - a.main.qh || a.idx - b.idx)

  const sheets: WorkSheet[] = []
  const unplaced: Piece[] = []

  const placeInStrips = (piece: Piece, tryOrder: Cand[]): boolean => {
    for (const sh of sheets) {
      for (const st of sh.strips) {
        for (const c of tryOrder) {
          const q = round1(st.used + kerf)
          if (round1(c.pw) <= round1(st.pw) && round1(q + c.qh) <= qCap) {
            st.items.push({ piece, c, q })
            st.used = round1(q + c.qh)
            return true
          }
        }
      }
    }
    return false
  }

  const openStrip = (sh: WorkSheet, piece: Piece, tryOrder: Cand[]): boolean => {
    const p = sh.strips.length === 0 ? 0 : round1(sh.pEnd + kerf)
    for (const c of tryOrder) {
      if (round1(p + c.pw) <= pCap && round1(c.qh) <= qCap) {
        sh.strips.push({ p, pw: c.pw, used: round1(c.qh), items: [{ piece, c, q: 0 }] })
        sh.pEnd = round1(p + c.pw)
        return true
      }
    }
    return false
  }

  for (const { piece, tryOrder } of items) {
    if (placeInStrips(piece, tryOrder)) continue
    if (sheets.some((sh) => openStrip(sh, piece, tryOrder))) continue
    const sh: WorkSheet = { strips: [], pEnd: 0 }
    if (openStrip(sh, piece, tryOrder)) sheets.push(sh)
    else unplaced.push(piece)
  }

  return {
    frame,
    unplaced,
    sheets: sheets.map((sh) => ({
      strips: sh.strips.map((st) => {
        const local: LocalRect = { p: st.p, q: 0, pw: st.pw, qh: qCap }
        return {
          local,
          rect: frame.toBoard(local),
          items: st.items.map(({ piece, c, q }) => {
            // 帯より細い片は帯の原点側（右端・手前）に寄せる
            const l: LocalRect = { p: st.p, q, pw: c.pw, qh: c.qh }
            const r = frame.toBoard(l)
            const placement: Placement = {
              ...r,
              pieceId: piece.pieceId,
              partId: piece.partId,
              name: piece.name,
              rotated: c.o.rotated,
              sizeLabel: piece.sizeLabel,
            }
            return { local: l, placement }
          }),
        }
      }),
    })),
  }
}

// 帯詰め（ギロチンカット）の配置。
// 帯を並べる方向を p、帯の中で片を並べる方向を q とする「帯の座標」で計算し、最後に板の座標に直す。
// 縦切り優先・横切り優先とも、その置き方（縦長／横長）の座標で同じ処理をする：
// p は使える範囲の右端から左へ、q は上端（奥）から下（手前）へ。片は右上から左下に向かって埋まり、
// 余りは左と帯の下（左下）に残る。
// - 縦切り優先（縦長）：帯は長手方向の縦長。帯の幅＝片の短辺方向の大きさ
// - 横切り優先（横長）：帯は妻手の幅いっぱいの縦長（図の上では縦）。帯の幅＝片の長辺方向の大きさ
import { round1 } from '../round'
import type { Placement, Rect } from '../types'
import { orientationsFor, type Orientation, type Piece } from './pieces'
import { usableRect, type StripMode } from './sheet'
import type { StockKind } from './stock'

export type { StripMode } from './sheet'

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
  /** 使える範囲（その置き方の座標） */
  usable: Rect
  /** 帯を並べる方向の長さ */
  pCap: number
  /** 帯の長さ */
  qCap: number
  toBoard(r: LocalRect): Rect
  /** 片の向きを帯の座標の大きさにする */
  sizes(o: Orientation): { pw: number; qh: number }
}

/** usable はその切り方の置き方の座標（sheet.ts の usableRect(board, trim, mode)） */
export function frameOf(mode: StripMode, usable: Rect): Frame {
  const right = usable.x + usable.w
  const top = usable.y + usable.h
  return {
    mode,
    usable,
    pCap: usable.w,
    qCap: usable.h,
    toBoard: (r) => ({ x: round1(right - r.p - r.pw), y: round1(top - r.q - r.qh), w: r.pw, h: r.qh }),
    // 片の向きは板の辺に対する大きさ（x：短辺方向、y：長辺方向）。横長では長辺方向が図の横
    sizes: mode === 'horizontal' ? (o) => ({ pw: o.y, qh: o.x }) : (o) => ({ pw: o.x, qh: o.y }),
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
  /** 帯の中の上端から詰めた順 */
  items: StripItem[]
}

export interface RawSheet {
  /** 右端から並べた順 */
  strips: StripLayout[]
}

export interface GuillotineResult {
  frame: Frame
  sheets: RawSheet[]
  /** 入る向きがなかった片（pieces.ts で除いているので通常は空） */
  unplaced: Piece[]
}

/** 手持ちの1行（第2.2版。architecture.md 14.4）：大きさ・木目・枚数と、その大きさの使える範囲・帯の座標 */
export interface SheetSpec {
  stock: StockKind
  usable: Rect
  frame: Frame
}

/** 手持ちで並べた1枚：どの手持ちの行を使ったかと、その1枚の帯の座標 */
export interface StockRawSheet extends RawSheet {
  stock: StockKind
  frame: Frame
}

export interface StockPackResult {
  /** 並べた順（1枚目から） */
  sheets: StockRawSheet[]
  /** 手持ちが尽きた・どの手持ちにも入らない片 */
  unplaced: Piece[]
  /** 行ごとに使った枚数（stock の並び） */
  used: number[]
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
  spec: number
  strips: WorkStrip[]
  /** 最後の帯の反対側の端（帯がなければ 0） */
  pEnd: number
}

interface CoreSpec {
  count: number
  /** 面積（新しい1枚を選ぶときに小さいほうから） */
  area: number
  /** 重ねた板の端材の行（第2.6版。新しい1枚を選ぶときに、ほかの行より先に使う。未決事項 62） */
  offcut?: boolean
  frame: Frame
}

interface CoreSheet {
  spec: number
  strips: StripLayout[]
}

/**
 * 帯詰めの本体。specs は手持ちの行（サイズを選んだ材料は1行・無限）、orient はその行に置いてよい片の向き。
 * 1. 帯の幅（p 方向）の大きい順 → 長さ（q 方向）の大きい順に並べる（基準の向きは、入る行のうち一番大きい値）
 * 2. 開いている板の帯を先頭から見て、片と同じ幅で、残りの長さに刃厚込みで入る最初の帯に置く
 *    （帯の中に縦に並べるのは、なるべく同じ幅の部材だけ。第2.5版。仕様書 8。sameWidthFirst が false なら飛ばす）
 * 3. なければ、残りの幅がある板に新しい帯を作る
 * 4. それもなければ、幅が収まり残りの長さに入る（幅の広い）最初の帯に置く
 *    （sameWidthFirst が false なら第2.4版までと同じく 3 の前に、同じ幅に限らず置く）
 * 5. それもなければ新しい板を出す：残りの枚数が 1 以上で、その片が入る行のうち面積が一番小さい行（同じなら登録順で前）。
 *    ただし重ねた板の端材の行（offcut）は、いつもほかの行より先に使う（端材の中で面積の小さい順。決定（オーナー）。未決事項 62）
 * 計算量は 片の数 × 帯の数 ＋ 片の数 × 行の数
 */
function packCore(
  pieces: readonly Piece[],
  specs: readonly CoreSpec[],
  kerf: number,
  orient: (piece: Piece, spec: number) => Orientation[],
  sameWidthFirst: boolean,
): { sheets: CoreSheet[]; unplaced: Piece[]; used: number[] } {
  const items = pieces.map((piece, idx) => {
    // 行ごとの試す順：帯の中の方向に長く置く向き（main）を先に
    const tries = specs.map((sp, k) => {
      const cands: Cand[] = orient(piece, k).map((o) => ({ o, ...sp.frame.sizes(o) }))
      if (cands.length === 0) return []
      let main = cands[0]
      for (const c of cands) if (c.qh > main.qh) main = c
      return [main, ...cands.filter((c) => c !== main)]
    })
    let key: Cand | null = null
    for (const t of tries) {
      const m = t[0]
      if (m && (!key || m.pw > key.pw || (m.pw === key.pw && m.qh > key.qh))) key = m
    }
    return { piece, idx, tries, key: key ?? { pw: 0, qh: 0 } }
  })
  items.sort((a, b) => b.key.pw - a.key.pw || b.key.qh - a.key.qh || a.idx - b.idx)

  const caps = specs.map((sp) => ({ p: round1(sp.frame.pCap), q: round1(sp.frame.qCap) }))
  // 新しい1枚を選ぶ順：端材の行 → ほかの行、それぞれ面積が小さい順（同じなら登録順）
  const rank = (k: number) => (specs[k].offcut ? 0 : 1)
  const order = specs.map((_, k) => k).sort((a, b) => rank(a) - rank(b) || specs[a].area - specs[b].area || a - b)
  const used = specs.map(() => 0)
  const sheets: WorkSheet[] = []
  const unplaced: Piece[] = []

  /** exact：片と同じ幅の帯だけに置く。そうでなければ幅が収まる帯に置く */
  const placeInStrips = (piece: Piece, tries: Cand[][], exact: boolean): boolean => {
    for (const sh of sheets) {
      const tryOrder = tries[sh.spec]
      if (tryOrder.length === 0) continue
      const qCap = caps[sh.spec].q
      for (const st of sh.strips) {
        for (const c of tryOrder) {
          const q = round1(st.used + kerf)
          const wide = exact ? round1(c.pw) === round1(st.pw) : round1(c.pw) <= round1(st.pw)
          if (wide && round1(q + c.qh) <= qCap) {
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
    const cap = caps[sh.spec]
    const p = sh.strips.length === 0 ? 0 : round1(sh.pEnd + kerf)
    for (const c of tryOrder) {
      if (round1(p + c.pw) <= cap.p && round1(c.qh) <= cap.q) {
        sh.strips.push({ p, pw: c.pw, used: round1(c.qh), items: [{ piece, c, q: 0 }] })
        sh.pEnd = round1(p + c.pw)
        return true
      }
    }
    return false
  }

  for (const { piece, tries } of items) {
    if (sameWidthFirst) {
      if (placeInStrips(piece, tries, true)) continue
      if (sheets.some((sh) => openStrip(sh, piece, tries[sh.spec]))) continue
      if (placeInStrips(piece, tries, false)) continue
    } else {
      if (placeInStrips(piece, tries, false)) continue
      if (sheets.some((sh) => openStrip(sh, piece, tries[sh.spec]))) continue
    }
    let placed = false
    for (const k of order) {
      if (specs[k].count - used[k] < 1 || tries[k].length === 0) continue
      const sh: WorkSheet = { spec: k, strips: [], pEnd: 0 }
      if (openStrip(sh, piece, tries[k])) {
        sheets.push(sh)
        used[k]++
        placed = true
        break
      }
    }
    if (!placed) unplaced.push(piece)
  }

  return {
    unplaced,
    used,
    sheets: sheets.map((sh) => {
      const frame = specs[sh.spec].frame
      const qCap = caps[sh.spec].q
      return {
        spec: sh.spec,
        strips: sh.strips.map((st) => {
          const local: LocalRect = { p: st.p, q: 0, pw: st.pw, qh: qCap }
          return {
            local,
            rect: frame.toBoard(local),
            items: st.items.map(({ piece, c, q }) => {
              // 帯より細い片は帯の右端に寄せる
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
      }
    }),
  }
}

/**
 * 片を帯詰めで1つの大きさの板（無限にある）に並べる。片の向きは piece.orientations。
 * 片はどれも使える範囲に入る向きを1つ以上持つこと（pieces.ts で確認済み）。
 * sameWidthFirst：帯の中は同じ幅の部材を優先する（第2.5版。false は第2.4版までの並べ方。比べるためだけに使う）
 */
export function packGuillotine(
  pieces: readonly Piece[],
  usable: Rect,
  kerf: number,
  mode: StripMode,
  sameWidthFirst = true,
): GuillotineResult {
  const frame = frameOf(mode, usable)
  const r = packCore(pieces, [{ count: Infinity, area: 0, frame }], kerf, (piece) => piece.orientations, sameWidthFirst)
  return { frame, unplaced: r.unplaced, sheets: r.sheets.map((sh) => ({ strips: sh.strips })) }
}

/** その行の端切り（端切りをしない行＝重ねた板の端材は 0。第2.6版） */
export function rowTrim(k: Pick<StockKind, 'noTrim'>, trim: number): number {
  return k.noTrim ? 0 : trim
}

/** 手持ちの行ごとの使える範囲と帯の座標（端切りをしない行は端切り 0） */
export function sheetSpecs(stock: readonly StockKind[], trim: number, mode: StripMode): SheetSpec[] {
  return stock.map((k) => {
    const usable = usableRect(k, rowTrim(k, trim), mode)
    return { stock: k, usable, frame: frameOf(mode, usable) }
  })
}

/**
 * 手持ちの材料で帯詰め（第2.2版。architecture.md 14.4）。1枚ごとにその大きさの使える範囲で並べる。
 * 片の向きは手持ちの行ごとに piece.shape から決め直す（shape の無い片は piece.orientations を使う）。
 * 新しい1枚は、残りが1以上でその片が入る行のうち面積が一番小さい行（同じなら登録順）。重ねた板の端材の行（offcut）は、いつもほかの行より先（第2.6版）。
 * サイズを選んだ材料（1行・無限）なら packGuillotine と同じ配置になる
 */
export function packOnStock(
  pieces: readonly Piece[],
  stock: readonly StockKind[],
  trim: number,
  kerf: number,
  mode: StripMode,
  sameWidthFirst = true,
): StockPackResult {
  const specs = sheetSpecs(stock, trim, mode)
  // 向きは行ごと・片の形ごとに1回だけ計算する
  const cache = specs.map(() => new Map<string, Orientation[]>())
  const orient = (piece: Piece, k: number): Orientation[] => {
    const shape = piece.shape
    if (!shape) return piece.orientations
    const key = `${shape.s0}|${shape.s1}|${shape.grain}`
    let o = cache[k].get(key)
    if (!o) {
      o = orientationsFor(shape, specs[k].stock, rowTrim(specs[k].stock, trim), mode)
      cache[k].set(key, o)
    }
    return o
  }
  const core = packCore(
    pieces,
    specs.map((sp) => ({ count: sp.stock.count, area: sp.stock.width * sp.stock.length, frame: sp.frame, offcut: !!sp.stock.offcut })),
    kerf,
    orient,
    sameWidthFirst,
  )
  return {
    sheets: core.sheets.map((sh) => ({ strips: sh.strips, stock: specs[sh.spec].stock, frame: specs[sh.spec].frame })),
    unplaced: core.unplaced,
    used: core.used,
  }
}

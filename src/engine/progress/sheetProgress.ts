// 1枚の進み具合（第1.8版。architecture.md 11.6）：チェックした片から、済んだ工程・次の工程・残りの材料を出す。
// 済んだ工程：チェックした片を取り出すのに要る工程（within がその片を含む工程＝ギロチンカットの木の先祖）を合わせたもの。
// 残りの材料：板全体（端切り前）から始め、済んだ工程を no の順に当てて長方形を2つに分けていく。
//   刃厚は測った側の反対側（余りの側）で消える：縦に切るなら線の左、横に切るなら線の下。
//   端切りは落とす側を捨て、残す側は刃厚を引かない（端切りの幅は刃厚を含む）。
//   残す側は、その1枚の使える範囲（layout.usable）のある側。縦は左を残す。横は、今の横切り優先（第1.9版〜）は
//   下の長手を落として上を残し、以前に保存した写しは上の長手を落として下を残す（写しのまま読み替えない）
import { MIN_SCRAP } from '../packing/scraps'
import { round1 } from '../round'
import type { CutStep, Rect, SheetLayout } from '../types'

export interface RemainingPiece {
  /** 1枚の置き方の座標 */
  rect: Rect
  /** この中にある、まだチェックしていない片。空なら切り離した余り（端材） */
  pieceIds: string[]
}

export interface SheetProgress {
  /** 済んだ工程（CutStep.no の小さい順） */
  doneSteps: number[]
  /** 次に切る工程（済んでいない一番小さい no）。全部済めば null */
  nextStep: number | null
  /** 残りの材料。部材の入っているもの → 端材 の順、それぞれ面積の大きい順 */
  remaining: RemainingPiece[]
}

/** 比べるときに許す誤差（小数第1位に丸めたうえで 0.1mm） */
const TOL = 0.1 + 1e-9

const le = (a: number, b: number) => round1(a) <= round1(b) + TOL
const near = (a: number, b: number) => Math.abs(round1(a) - round1(b)) <= TOL

/** outer が inner を含む */
function contains(outer: Rect, inner: Rect): boolean {
  return le(outer.x, inner.x) && le(outer.y, inner.y) && le(inner.x + inner.w, outer.x + outer.w) && le(inner.y + inner.h, outer.y + outer.h)
}

function sameRect(a: Rect, b: Rect): boolean {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
}

/** 重なりがある（辺が接するだけは重ならない） */
function overlaps(a: Rect, b: Rect): boolean {
  return round1(a.x) + TOL < round1(b.x + b.w) && round1(b.x) + TOL < round1(a.x + a.w) &&
    round1(a.y) + TOL < round1(b.y + b.h) && round1(b.y) + TOL < round1(a.y + a.h)
}

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x: round1(x), y: round1(y), w: round1(w), h: round1(h) }
}

/** 端切りで残す側が、線より上（横）・右（縦）か。使える範囲がその側にあるかで決める */
function keepsHigh(c: CutStep, usable: Rect): boolean {
  return c.direction === 'vertical' ? le(c.at, usable.x) : le(c.at, usable.y)
}

/** 工程 c で長方形 r を2つに分ける（大きさが 0 以下になる側・端切りで落とす側は捨てる） */
function split(r: Rect, c: CutStep, kerf: number, usable: Rect): Rect[] {
  const trim = c.kind === 'trim'
  const high = !trim || keepsHigh(c, usable)
  const low = !trim || !high
  const k = trim ? 0 : kerf
  const out: Rect[] = []
  if (c.direction === 'vertical') {
    const right = r.x + r.w
    if (high && round1(right - c.at) > 0) out.push(rect(c.at, r.y, right - c.at, r.h))
    const leftW = c.at - k - r.x
    if (low && round1(leftW) > 0) out.push(rect(r.x, r.y, leftW, r.h))
  } else {
    const top = r.y + r.h
    if (high && round1(top - c.at) > 0) out.push(rect(r.x, c.at, r.w, top - c.at))
    const downH = c.at - k - r.y
    if (low && round1(downH) > 0) out.push(rect(r.x, r.y, r.w, downH))
  }
  return out
}

const byArea = (a: RemainingPiece, b: RemainingPiece) => b.rect.w * b.rect.h - a.rect.w * a.rect.h

/**
 * 1枚の進み具合。kerf はその1枚を並べたときの刃厚（固定した1枚は写しの刃厚）。
 * 写しに無い pieceId・重複は無視する
 */
export function sheetProgress(layout: SheetLayout, kerf: number, checked: readonly string[]): SheetProgress {
  const checkedSet = new Set(checked)
  const done = layout.placements.filter((p) => checkedSet.has(p.pieceId))
  const rest = layout.placements.filter((p) => !checkedSet.has(p.pieceId))

  const doneSteps = layout.cuts
    .filter((c) => done.some((p) => contains(c.within, p)))
    .map((c) => c.no)
    .sort((a, b) => a - b)
  const doneSet = new Set(doneSteps)
  const next = layout.cuts.map((c) => c.no).filter((n) => !doneSet.has(n))
  const nextStep = next.length > 0 ? Math.min(...next) : null

  // 板全体（端切り前）から、済んだ工程を順に当てる
  const whole =
    layout.orientation === 'landscape'
      ? rect(0, 0, layout.boardLength, layout.boardWidth)
      : rect(0, 0, layout.boardWidth, layout.boardLength)
  let rects: Rect[] = [whole]
  for (const c of [...layout.cuts].sort((a, b) => a.no - b.no)) {
    if (!doneSet.has(c.no)) continue
    const i = rects.findIndex((r) => contains(r, c.within))
    if (i < 0) continue
    rects = [...rects.slice(0, i), ...split(rects[i], c, kerf, layout.usable), ...rects.slice(i + 1)]
  }

  const withPieces: RemainingPiece[] = []
  const scraps: RemainingPiece[] = []
  for (const r of rects) {
    const inside = rest.filter((p) => contains(r, p)).map((p) => p.pieceId)
    if (inside.length > 0) {
      withPieces.push({ rect: r, pieceIds: inside })
      continue
    }
    // 切り出した部材（またはそれを含む切れ端）は出さない
    if (done.some((p) => sameRect(r, p) || overlaps(r, p))) continue
    if (round1(r.w) >= MIN_SCRAP && round1(r.h) >= MIN_SCRAP) scraps.push({ rect: r, pieceIds: [] })
  }
  return { doneSteps, nextStep, remaining: [...withPieces.sort(byArea), ...scraps.sort(byArea)] }
}

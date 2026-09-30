// E-77（第2.6版。architecture.md 18.11）：新しい重ね切りのストレステスト。
// 家具らしい仕事・でたらめな仕事 各60件（材料グループ・材料を直接選んだ部材・手持ち・固定した1枚・組の行と材料の行のサイズ違いを混ぜる）で、
// ① どの1枚もギロチンで切れる ② 部材ごと・材料ごとの数が合う ③ 材料ごとにオンの枚数 ≦ オフの枚数・入らない片も増えない
// ④ 端材の1枚は重ねた板の端材と同じ大きさ・木目で、1つの端材から1枚まで・端切りなし ⑤ どの重ねた板も上下が違う材料 を確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { A, ABC, B, BETA20, C, FLUSH25, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import { stockRows, type StockRowDraft } from '../fixtures/stock'
import { freezeSheet, frozenDemand } from '../progress/frozen'
import { round1 } from '../round'
import { BOARD_SIZES, type CutStep, type Job, type Part, type PackingResult, type Rect, type SheetLayout } from '../types'
import { packJob } from './index'
import { offcutStock, stackSheetNumbers } from './offcuts'
import { cutFaces } from './stack'

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s / 4294967296
  }
}
type R = () => number
const int = (r: R, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T,>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]

const CUT_BOARDS = [MEL, L4, L18, A, B, C]
const GROUPS = [FLUSH25, BETA20, ABC]
const NOW = new Date('2026-09-30T00:00:00.000Z')

function sizeTo(job: Job, id: string, kind: 'saburoku' | 'shihachi') {
  const [width, length] = BOARD_SIZES[kind]
  job.boards = job.boards.map((b) => (b.id === id ? { ...b, sizeKind: kind, width, length, grain: 'long' } : b))
}

function randomJob(seed: number, furniture: boolean): Job {
  const r = rng(seed * 7919 + (furniture ? 1 : 2))
  const parts: Part[] = []
  const n = furniture ? int(r, 4, 10) : int(r, 2, 14)
  for (let i = 0; i < n; i++) {
    const grain = pick(r, ['H', 'D', 'any'] as const)
    const h = furniture ? pick(r, [300, 450, 600, 720, 900, 1200, 1500, 1800]) + int(r, 0, 20) : int(r, 40, 2300)
    const d = furniture ? pick(r, [150, 250, 300, 400, 450, 600]) + int(r, 0, 10) : int(r, 40, 1200)
    const q = int(r, 1, furniture ? 4 : 6)
    if (r() < 0.6) parts.push(groupPart(`g${i}`, pick(r, GROUPS), h, d, q, grain))
    else parts.push(boardPart(`d${i}`, pick(r, CUT_BOARDS), h, d, q, grain))
  }
  const job = stackJob(parts)
  job.settings = { ...job.settings, kerf: pick(r, [2, 3, 4]), trim: pick(r, [0, 5, 10]), cutMode: pick(r, ['vertical', 'horizontal', 'auto'] as const) }
  for (const id of CUT_BOARDS) if (r() < 0.35) sizeTo(job, id, 'shihachi')
  // 手持ち（自由入力）の材料
  if (r() < 0.3) {
    const id = pick(r, CUT_BOARDS)
    const rows: StockRowDraft[] = [[pick(r, ['3×6', '4×8'] as const), int(r, 1, 4)]]
    if (r() < 0.5) rows.push({ width: int(r, 300, 900), length: int(r, 900, 2000), grain: pick(r, ['long', 'short'] as const), count: int(r, 1, 3) })
    const b = job.boards.find((x) => x.id === id)!
    b.stockOn = true
    b.stock = stockRows(rows)
  }
  // 組の行（材料の行とサイズ違いを混ぜる）
  for (const pair of [[MEL, L4], [MEL, L18], [A, C], [B, C]] as const) {
    if (r() < 0.4) {
      const kind = pick(r, ['saburoku', 'shihachi'] as const)
      const [width, length] = BOARD_SIZES[kind]
      job.stackSheets.push({ boardIds: [pair[0], pair[1]], sizeKind: kind, width, length, grain: 'long' })
    }
  }
  // 固定した1枚（重ねた板・端材の1枚・ふつうの1枚のどれか）
  if (r() < 0.35) {
    const res = packJob(job, computeDimensions(job))
    const ms = res.materials.filter((m) => m.sheets.length > 0)
    if (ms.length > 0) {
      const m = pick(r, ms)
      const layout = pick(r, m.sheets)
      const a = m.stack ? m.stack.boardIds[0] : m.boardId
      const f = freezeSheet(job, a, m.mode, layout, `f${seed}`, NOW, m.stack?.boardIds[1])
      f.checked = [layout.placements[0].pieceId]
      if (layout.placements.length === 1) f.completedAt = NOW.toISOString()
      job.frozenSheets = [f]
    }
  }
  return job
}

const same = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6

/** 切る順番どおりに板を2つずつに分け、最後に片がそのままの形で1つずつ残ること（ギロチン）。片は使える範囲の中 */
function expectGuillotine(s: SheetLayout, kerf: number, tag: string) {
  const whole = s.orientation === 'portrait' ? { x: 0, y: 0, w: s.boardWidth, h: s.boardLength } : { x: 0, y: 0, w: s.boardLength, h: s.boardWidth }
  let rects: Rect[] = [whole]
  s.cuts.forEach((c: CutStep) => {
    const idx = rects.findIndex((r) => same(r, c.within))
    expect(idx, `${tag} 切断 ${c.no}`).toBeGreaterThanOrEqual(0)
    const r = rects[idx]
    const k = c.kind === 'trim' ? 0 : kerf
    const next: Rect[] = []
    if (c.direction === 'vertical') {
      next.push({ x: c.at, y: r.y, w: r.x + r.w - c.at, h: r.h })
      if (c.at - k > r.x) next.push({ x: r.x, y: r.y, w: c.at - k - r.x, h: r.h })
    } else {
      next.push({ x: r.x, y: c.at, w: r.w, h: r.y + r.h - c.at })
      if (c.at - k > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: c.at - k - r.y })
    }
    rects = [...rects.slice(0, idx), ...next, ...rects.slice(idx + 1)]
  })
  for (const p of s.placements) {
    expect(p.x, tag).toBeGreaterThanOrEqual(s.usable.x - 1e-9)
    expect(p.x + p.w, tag).toBeLessThanOrEqual(s.usable.x + s.usable.w + 1e-9)
    expect(p.y, tag).toBeGreaterThanOrEqual(s.usable.y - 1e-9)
    expect(p.y + p.h, tag).toBeLessThanOrEqual(s.usable.y + s.usable.h + 1e-9)
    expect(rects.filter((r) => same(r, p)), `${tag} ${p.pieceId} が切り出されていない`).toHaveLength(1)
  }
}

/** 部材×材料ごとの枚数（仕事から）。計算から除いた・入らない部材は除く */
function expected(job: Job, excluded: Set<string>): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of job.parts) {
    if (excluded.has(p.id) || p.quantity < 1) continue
    const faces = p.flushId !== undefined ? cutFaces(job.flushes.find((f) => f.id === p.flushId)!, job.boards) : [{ boardId: p.boardId!, count: 1 }]
    for (const f of faces) out.set(`${p.id}|${f.boardId}`, (out.get(`${p.id}|${f.boardId}`) ?? 0) + f.count * p.quantity)
  }
  return out
}

/** 計算した1枚の片を、部材×材料ごとに数える（重ねた板の片は上下の両方に） */
function placed(r: PackingResult): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of r.materials) {
    const ids = m.stack ? m.stack.boardIds : [m.boardId]
    for (const s of m.sheets) for (const p of s.placements) for (const b of ids) out.set(`${p.partId}|${b}`, (out.get(`${p.partId}|${b}`) ?? 0) + 1)
  }
  return out
}

/** 材料 id の枚数（その材料を含む重ねた板 ＋ 材料の行の1枚。端材の1枚を除く）と、置けた片の数 */
function countOf(r: PackingResult, id: string): { sheets: number; pieces: number } {
  let sheets = 0
  let pieces = 0
  for (const m of r.materials) {
    if (m.boardId !== id && !m.stack?.boardIds.includes(id)) continue
    sheets += m.sheetCount
    for (const s of m.sheets) pieces += s.placements.length
  }
  return { sheets, pieces }
}

const stats = { jobs: 0, offSheets: 0, onSheets: 0, stacked: 0, offcutSheets: 0, rejected: 0, frozen: 0, morePlacedMoreSheets: 0, morePlacedJobs: 0, samePlacedOn: 0, samePlacedOff: 0 }

function check(job: Job, tag: string) {
  const dims = computeDimensions(job)
  const on = packJob(job, dims)
  const off = packJob({ ...job, stacking: 'off' }, dims)
  for (const [r, name] of [[on, 'on'], [off, 'off']] as const) {
    const t = `${tag} ${name}`
    // ① ギロチン
    for (const m of r.materials) for (const s of m.sheets) expectGuillotine(s, job.settings.kerf, `${t} ${m.boardId}`)
    // ② 数
    const excluded = new Set([...r.skipped.map((s) => s.partId), ...r.materials.flatMap((m) => m.unplaced.map((u) => u.partId))])
    const got = placed(r)
    for (const [k, v] of frozenDemand(job)) got.set(k, (got.get(k) ?? 0) + v)
    for (const k of [...got.keys()]) if (excluded.has(k.split('|')[0])) got.delete(k)
    expect(Object.fromEntries(got), t).toEqual(Object.fromEntries(expected(job, excluded)))
    for (const m of r.materials) {
      const ids = m.sheets.flatMap((s) => s.placements.map((p) => p.pieceId))
      expect(new Set(ids).size, `${t} ${m.boardId} の片の id`).toBe(ids.length)
      // ⑤ 重ねた板は違う2つの材料
      if (m.stack) expect(m.stack.boardIds[0], t).not.toBe(m.stack.boardIds[1])
    }
    // ④ 端材の1枚
    const rows = offcutStock(stackSheetNumbers(job, r.materials))
    for (const m of r.materials) {
      if (m.stack) continue
      const offcuts = m.sheets.filter((s) => s.sheet?.offcut)
      expect(m.offcutSheetCount, t).toBe(offcuts.length)
      expect(m.sheetCount, t).toBe(m.sheets.length - offcuts.length)
      const usedIds = new Set<string>()
      for (const s of offcuts) {
        const row = (rows.get(m.boardId) ?? []).find((k) => k.stockId === s.sheet!.stockId)
        expect(row, `${t} ${s.sheet!.stockId}`).toBeDefined()
        expect([round1(s.boardWidth), round1(s.boardLength), s.sheet!.grain, s.sheet!.offcut!.source]).toEqual([row!.width, row!.length, row!.grain, row!.offcut!.source])
        expect(usedIds.has(row!.stockId!), `${t} 同じ端材を2回`).toBe(false)
        usedIds.add(row!.stockId!)
        expect(s.trims, t).toEqual([])
        const u = s.orientation === 'portrait' ? { x: 0, y: 0, w: s.boardWidth, h: s.boardLength } : { x: 0, y: 0, w: s.boardLength, h: s.boardWidth }
        expect(same(s.usable, u), t).toBe(true)
      }
    }
  }
  // ③ 材料ごとに 入らない片が増えない（置けた片が減らない）。置けた片が同じなら オンの枚数 ≦ オフの枚数
  // （オフで入らない片がオンで重ねた板の端材に入るときは、その片のぶん枚数が増えることがある。数えて報告する）
  for (const id of CUT_BOARDS) {
    const a = countOf(on, id)
    const b = countOf(off, id)
    expect(a.pieces, `${tag} ${id} の置けた片`).toBeGreaterThanOrEqual(b.pieces)
    if (a.pieces === b.pieces) expect(a.sheets, `${tag} ${id} の枚数`).toBeLessThanOrEqual(b.sheets)
    else if (a.sheets > b.sheets) stats.morePlacedMoreSheets++
  }
  const sheetsOf = (r: PackingResult) => r.materials.reduce((n, m) => n + m.sheetCount * (m.stack ? 2 : 1), 0)
  if (CUT_BOARDS.every((id) => countOf(on, id).pieces === countOf(off, id).pieces)) {
    stats.samePlacedOn += sheetsOf(on)
    stats.samePlacedOff += sheetsOf(off)
  } else stats.morePlacedJobs++
  stats.jobs++
  stats.offSheets += off.materials.reduce((n, m) => n + m.sheetCount * (m.stack ? 2 : 1), 0)
  stats.onSheets += on.materials.reduce((n, m) => n + m.sheetCount * (m.stack ? 2 : 1), 0)
  stats.stacked += on.materials.filter((m) => m.stack).reduce((n, m) => n + m.sheetCount, 0)
  stats.offcutSheets += on.materials.reduce((n, m) => n + m.offcutSheetCount, 0)
  stats.rejected += on.stacks.rejected.length
  stats.frozen += job.frozenSheets.length
}

describe('新しい重ね切りのストレステスト（E-77）', () => {
  it('家具らしい仕事 60件・でたらめな仕事 60件', () => {
    for (let seed = 1; seed <= 60; seed++) check(randomJob(seed, true), `家具 ${seed}`)
    for (let seed = 1; seed <= 60; seed++) check(randomJob(seed, false), `でたらめ ${seed}`)
    expect(stats.jobs).toBe(120)
    expect(stats.stacked).toBeGreaterThan(50)
    expect(stats.offcutSheets).toBeGreaterThan(10)
    expect(stats.frozen).toBeGreaterThan(10)
    // 置けた片がオン・オフで同じ仕事では、板の合計（重ねた板は2枚）がオフ以下
    expect(stats.samePlacedOn).toBeLessThanOrEqual(stats.samePlacedOff)
    // 第2.6版を作ったときの値（進行役に報告）：オフの板 1818・オンの板 1876（重ねた板は2枚）、重ねた板 532、端材から取った1枚 255、
    // rejected の組 123、固定した1枚 42。置けた片が同じ 79件はオン 903 ≦ オフ 955。41件はオンのほうが多くの片を置け、そのぶん板が増える材料が 42
    expect(stats.rejected).toBeGreaterThan(10)
  }, 60_000)
})

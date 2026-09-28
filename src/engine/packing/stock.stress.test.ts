// 手持ちの材料（第2.2版）のでたらめな仕事での確かめ：
// 大きさの混ざった手持ち・枚数・重ね切り（第2.3版：組の行ごとのサイズ。組は手持ちを使わない）・固定した1枚をでたらめに作り、
// 1枚ごとにギロチンで切れること・手持ちの枚数を超えないこと・入らない片は本当に手持ちが無いときだけであること・
// 足りないときの解決策をそのまま当てると入ること、を確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { stockShortage } from '../hints/shortage'
import { freezeSheet } from '../progress/frozen'
import { round1 } from '../round'
import { BOARD_SIZES, type Board, type BoardGrain, type Job, type PackingResult, type Part, type Rect, type SheetChoice, type SheetLayout, type StackSheet, type StockSheet } from '../types'
import { packJob } from './index'
import { expandPieces, orientationsFor, type PieceShape } from './pieces'
import { findStackSheet, samePair, sameStockSize, stackChoice, stockKinds, usesStock } from './stock'
import { stackPlan } from './stack'

/** 決まった順に出るでたらめな数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}
type Rng = ReturnType<typeof rng>

const A = 'b-a18'
const B = 'b-b4'
const C = 'b-c1'
const FLUSH = 'fl-1'

function randomStock(r: Rng): StockSheet[] {
  const rows: StockSheet[] = []
  const n = r.int(1, 3)
  for (let i = 0; i < n; i++) {
    const kind = r.pick(['saburoku', 'shihachi', 'custom'] as const)
    const count = r.int(1, 4)
    if (kind === 'custom') {
      const w = r.int(3, 13) * 100
      const l = r.int(Math.max(6, w / 100), 26) * 100
      rows.push({ id: `s${i}`, sizeKind: 'custom', width: w, length: l, grain: r.pick(['long', 'short'] as const), count })
    } else {
      const [width, length] = BOARD_SIZES[kind]
      rows.push({ id: `s${i}`, sizeKind: kind, width, length, grain: 'long', count })
    }
  }
  return rows
}

function randomBoard(r: Rng, id: string, material: string, thickness: number): Board {
  const kind = r.pick(['saburoku', 'shihachi'] as const)
  const [width, length] = BOARD_SIZES[kind]
  const b: Board = { id, material, thickness, sizeKind: kind, width, length, grain: 'long' }
  if (r.chance(0.7)) {
    b.stock = randomStock(r)
    if (r.chance(0.85)) b.stockOn = true
  }
  return b
}

/**
 * 組の行（第2.3版）：3×6／4×8／以前の自由入力（大きさだけ）のどれか。手持ちが残っていることも多い（読み込みで外すが、
 * 木取りが見ないことを確かめるため。E-64）。boardIds の並びもでたらめ
 */
function randomStackSheet(r: Rng, boardIds: [string, string]): StackSheet {
  const kind = r.pick(['saburoku', 'shihachi', 'custom'] as const)
  const size =
    kind === 'custom'
      ? { width: r.int(6, 12) * 100, length: r.int(13, 26) * 100, grain: r.pick(['long', 'short'] as const) }
      : { width: BOARD_SIZES[kind][0], length: BOARD_SIZES[kind][1], grain: 'long' as const }
  const s: StackSheet = { boardIds: r.chance(0.5) ? boardIds : [boardIds[1], boardIds[0]], sizeKind: kind, ...size }
  if (r.chance(0.6)) {
    s.stock = randomStock(r)
    if (r.chance(0.85)) s.stockOn = true
  }
  return s
}

function part(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
  return { boardId: null, thicknessAxis: null, quantity: 1, grain: 'any', memo: '', checks: { finished: false, cut: false }, allowance: null, ...p }
}

function randomJob(r: Rng, pieces: [number, number] = [4, 30]): Job {
  const boards = [randomBoard(r, A, 'ランバー', 18), randomBoard(r, B, 'ラワン', 4), randomBoard(r, C, 'メラミン', 1)]
  const stack = r.chance(0.6)
  // 組の行の設定（第2.3版）。無ければ 4×8
  const stackSheets = stack && r.chance(0.8) ? [randomStackSheet(r, [B, C])] : []
  const parts: Part[] = []
  let total = 0
  const target = r.int(pieces[0], pieces[1])
  let i = 0
  while (total < target) {
    i++
    const quantity = Math.min(r.int(1, 6), target - total)
    total += quantity
    const grain = r.pick(['any', 'H', 'D'] as const)
    const h = String(r.int(8, 250) * 10)
    const d = String(r.int(8, 130) * 10)
    if (r.chance(0.35)) {
      // フラッシュの部材（メラミン1×1＋ラワン4×1 → 表面材ごとに quantity 枚）
      parts.push(part({ id: `p${i}`, name: `部材${i}`, flushId: FLUSH, expr: { W: `{t:${FLUSH}}`, H: h, D: d }, quantity, grain }))
    } else {
      const board = r.pick([A, B])
      const t = board === A ? '18' : '4'
      parts.push(part({ id: `p${i}`, name: `部材${i}`, boardId: board, expr: { W: t, H: h, D: d }, quantity, grain, allowance: r.pick([0, 5, 10]) }))
    }
  }
  return {
    id: 'job-stress',
    name: 'でたらめ',
    settings: { kerf: r.pick([2, 3, 4.5]), trim: r.pick([0, 3, 5, 10]), allowance: r.pick([0, 5, 10]), cutMode: r.pick(['vertical', 'horizontal', 'auto'] as const), nige: [] },
    boards,
    flushes: [{ id: FLUSH, name: 'フラッシュ20', core: 15, faces: [{ boardId: C, count: 1 }, { boardId: B, count: 1 }], ...(stack ? { stack: true as const } : {}) }],
    parts,
    frozenSheets: [],
    stackSheets,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

// ---------- 確かめ ----------

/** 確かめた数（でたらめな仕事で本当に確かめられているか） */
const seen = { sheets: 0, noStock: 0, adds: 0, changes: 0, mixedSizes: 0, stackStock: 0, stackCustom: 0 }

/** 片の集まりが、端から端までの一直線の切断をくり返して切り分けられるか（ギロチン） */
function guillotine(rects: readonly Rect[]): boolean {
  if (rects.length <= 1) return true
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'w' : 'h'
    const sorted = [...rects].sort((a, b) => a[axis] - b[axis])
    let end = -Infinity
    for (let i = 0; i < sorted.length - 1; i++) {
      end = Math.max(end, round1(sorted[i][axis] + sorted[i][size]))
      if (end <= round1(sorted[i + 1][axis])) {
        return guillotine(sorted.slice(0, i + 1)) && guillotine(sorted.slice(i + 1))
      }
    }
  }
  return false
}

function checkSheet(s: SheetLayout, kerf: number) {
  seen.sheets++
  const [W, H] = s.orientation === 'portrait' ? [s.boardWidth, s.boardLength] : [s.boardLength, s.boardWidth]
  const u = s.usable
  expect(u.x).toBeGreaterThanOrEqual(0)
  expect(u.y).toBeGreaterThanOrEqual(0)
  expect(round1(u.x + u.w)).toBeLessThanOrEqual(round1(W))
  expect(round1(u.y + u.h)).toBeLessThanOrEqual(round1(H))
  const ps = s.placements
  for (const p of ps) {
    expect(round1(p.x)).toBeGreaterThanOrEqual(round1(u.x))
    expect(round1(p.y)).toBeGreaterThanOrEqual(round1(u.y))
    expect(round1(p.x + p.w)).toBeLessThanOrEqual(round1(u.x + u.w))
    expect(round1(p.y + p.h)).toBeLessThanOrEqual(round1(u.y + u.h))
  }
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]
      const b = ps[j]
      const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))
      expect(round1(gap)).toBeGreaterThanOrEqual(round1(kerf))
    }
  }
  expect(guillotine(ps)).toBe(true)
}

type Size = { width: number; length: number; grain: BoardGrain }

/**
 * 行（材料の行・組の行）で使った1枚（固定した1枚（切り終わりを含む）・計算した1枚）の大きさ。
 * 第2.3版：材料の行はその材料だけの1枚、組の行は組の1枚（材料の手持ちから組の分を引かない）
 */
function usedSizes(job: Job, r: PackingResult, row: { board: Board } | { pair: [string, string] }, grain: BoardGrain): Size[] {
  const out: Size[] = []
  const mine = (boardId: string, stackWith: string | undefined) =>
    'board' in row ? boardId === row.board.id && stackWith === undefined : stackWith !== undefined && samePair([boardId, stackWith], row.pair)
  for (const f of job.frozenSheets) {
    if (mine(f.boardId, f.stackWith?.boardId)) out.push({ width: f.layout.boardWidth, length: f.layout.boardLength, grain: f.grain })
  }
  for (const m of r.materials) {
    if (!(m.stack ? mine(m.stack.boardIds[0], m.stack.boardIds[1]) : mine(m.boardId, undefined))) continue
    for (const s of m.sheets) out.push({ width: s.boardWidth, length: s.boardLength, grain: s.sheet?.grain ?? grain })
  }
  return out
}

/** 大きさごとの 残り枚数（手持ちの枚数 − 使った枚数）。使った枚数が手持ちを超えないことも確かめる */
function remaining(job: Job, r: PackingResult, choice: SheetChoice, row: { board: Board } | { pair: [string, string] }): { size: Size; left: number }[] {
  const groups: { size: Size; left: number }[] = []
  for (const k of stockKinds(choice)) {
    const g = groups.find((x) => sameStockSize(x.size, k))
    if (g) g.left += k.count
    else groups.push({ size: { width: k.width, length: k.length, grain: k.grain }, left: k.count })
  }
  // 固定した1枚は、そろう行が無ければ手持ちから引かない（手持ちを書き換えた後など）
  for (const s of usedSizes(job, r, row, choice.grain)) {
    const g = groups.find((x) => sameStockSize(x.size, s))
    if (g) g.left--
  }
  for (const g of groups) expect(g.left).toBeGreaterThanOrEqual(0)
  return groups
}

function shapesByPart(job: Job): Map<string, PieceShape> {
  const out = new Map<string, PieceShape>()
  for (const g of expandPieces(job, computeDimensions(job)).groups) for (const p of g.pieces) if (p.shape) out.set(p.partId, p.shape)
  return out
}

function checkJob(job: Job) {
  const dims = computeDimensions(job)
  const r = packJob(job, dims)
  for (const m of r.materials) {
    for (const s of m.sheets) checkSheet(s, job.settings.kerf)
    if (new Set(m.sheets.map((s) => `${s.boardWidth}x${s.boardLength}`)).size > 1) seen.mixedSizes++
  }
  const shapes = shapesByPart(job)
  for (const board of job.boards) {
    if (!usesStock(board)) {
      // サイズを選んだ材料に noStock は出ない
      for (const m of r.materials) if (m.boardId === board.id) expect(m.unplaced.every((u) => u.reason === 'tooLarge')).toBe(true)
      continue
    }
    const left = remaining(job, r, board, { board })
    checkNoStock(job, r.materials.find((x) => !x.stack && x.boardId === board.id), left, shapes)
  }
  // 組の行（E-64）：組は 3×6／4×8 だけで手持ちを使わない。行に手持ち・自由入力が残っていても、tooLarge だけで、1枚は組の大きさ
  for (const g of stackPlan(job).groups) {
    const choice = stackChoice(job, g.boardIds)
    expect(usesStock(choice)).toBe(false)
    expect(choice.sizeKind).not.toBe('custom')
    const row = findStackSheet(job, g.boardIds)
    if (row && usesStock(row)) seen.stackStock++
    if (row?.sizeKind === 'custom') seen.stackCustom++
    const m = r.materials.find((x) => x.boardId === g.key)
    if (m) expect(m.stack?.boardIds).toEqual(g.boardIds)
    expect(m?.unplaced.every((u) => u.reason === 'tooLarge') ?? true).toBe(true)
    for (const s of m?.sheets ?? []) expect([s.boardWidth, s.boardLength, s.sheet]).toEqual([choice.width, choice.length, undefined])
  }
  return { r, dims }
}

/** 手持ちの行は tooLarge を出さず、入らない片は残りのある手持ちのどれにも入らない（本当に手持ちが無い） */
function checkNoStock(job: Job, m: PackingResult['materials'][number] | undefined, left: { size: Size; left: number }[], shapes: Map<string, PieceShape>) {
  expect(m?.unplaced.every((u) => u.reason === 'noStock') ?? true).toBe(true)
  for (const u of m?.unplaced ?? []) {
    const shape = shapes.get(u.partId)!
    seen.noStock++
    for (const g of left) {
      if (g.left < 1) continue
      expect(orientationsFor(shape, g.size, job.settings.trim, m!.mode)).toEqual([])
    }
  }
}

function short(r: PackingResult, boardId: string): boolean {
  return r.materials.some((m) => m.boardId === boardId && m.unplaced.some((u) => u.reason === 'noStock'))
}

function checkShortage(job: Job) {
  const dims = computeDimensions(job)
  const list = stockShortage(job, dims)
  const r0 = packJob(job, dims)
  // 足りない材料の行はすべて知らせる（組の行は手持ちを使わないので出ない。E-64）
  expect(list.map((s) => s.boardId)).toEqual(r0.materials.filter((m) => short(r0, m.boardId)).map((m) => m.boardId))
  for (const s of list) {
    expect(s.stack).toBeUndefined()
    for (const a of s.add) {
      if (a.count === null) continue
      const [width, length] = BOARD_SIZES[a.kind]
      const row = { id: 'added', sizeKind: a.kind, width, length, grain: 'long' as const, count: a.count }
      // 画面と同じく、押した行1つにだけ足す
      const added: Job = { ...job, boards: job.boards.map((b) => (b.id === s.boardId ? { ...b, stock: [...(b.stock ?? []), row] } : b)) }
      expect(short(packJob(added, dims), s.boardId)).toBe(false)
      seen.adds++
    }
    if (s.change) {
      const changed: Job = { ...job, settings: { ...job.settings, [s.change.kind]: s.change.value } }
      expect(short(packJob(changed, computeDimensions(changed)), s.boardId)).toBe(false)
      seen.changes++
    }
  }
  return list
}

/** 計算した1枚をでたらめに固定する（チェック1つ、または切り終わり） */
function freezeSome(r: Rng, job: Job, result: PackingResult): Job {
  const next: Job = { ...job, frozenSheets: [...job.frozenSheets] }
  for (const m of result.materials) {
    if (m.sheets.length === 0 || !r.chance(0.5)) continue
    const s = m.sheets[0]
    const boardId = m.stack ? m.stack.boardIds[0] : m.boardId
    const f = freezeSheet(next, boardId, m.mode, s, `f-${next.frozenSheets.length}`, new Date('2026-09-27T00:00:00.000Z'), m.stack?.boardIds[1])
    if (r.chance(0.5)) {
      f.checked = s.placements.map((p) => p.pieceId)
      f.completedAt = '2026-09-27T00:00:00.000Z'
    } else {
      f.checked = [s.placements[0].pieceId]
    }
    next.frozenSheets.push(f)
  }
  return next
}

describe('手持ちの材料：でたらめな仕事での確かめ', () => {
  it('ギロチン・手持ちの枚数・入らない片・解決策（固定した1枚を含む）', () => {
    let shortages = 0
    let stacks = 0
    let frozenCount = 0
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed)
      const job = randomJob(r)
      const { r: result } = checkJob(job)
      stacks += stackPlan(job).groups.length
      shortages += checkShortage(job).length
      // 固定した1枚を足して、もう一度
      const frozen = freezeSome(r, job, result)
      frozenCount += frozen.frozenSheets.length
      checkJob(frozen)
      checkShortage(frozen)
    }
    // でたらめでも、足りない・重ね切り・固定のどれも起きていること
    expect(shortages).toBeGreaterThan(5)
    expect(stacks).toBeGreaterThan(5)
    expect(frozenCount).toBeGreaterThan(5)
    expect(seen.sheets).toBeGreaterThan(200)
    expect(seen.noStock).toBeGreaterThan(10)
    expect(seen.adds).toBeGreaterThan(10)
    expect(seen.mixedSizes).toBeGreaterThan(5)
    expect(seen.stackStock).toBeGreaterThan(5)
    expect(seen.stackCustom).toBeGreaterThan(3)
  })

  it('部材150枚（手持ち・重ね切りあり）で packJob が 1秒以内', () => {
    for (let seed = 101; seed <= 105; seed++) {
      const job = randomJob(rng(seed), [150, 150])
      const dims = computeDimensions(job)
      const t0 = performance.now()
      packJob(job, dims)
      expect(performance.now() - t0).toBeLessThan(1000)
    }
  })

  it('部材150枚で stockShortage も 1秒以内', () => {
    for (let seed = 201; seed <= 203; seed++) {
      const job = randomJob(rng(seed), [150, 150])
      for (const b of job.boards) {
        b.stockOn = true
        b.stock = [
          { id: 'x1', sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 2 },
          { id: 'x2', sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long', count: 1 },
        ]
      }
      const dims = computeDimensions(job)
      const t0 = performance.now()
      const list = stockShortage(job, dims)
      expect(performance.now() - t0).toBeLessThan(1000)
      expect(list.length).toBeGreaterThan(0)
    }
  })
})

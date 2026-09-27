// 重ね切りの負荷・つじつまの確認：乱数で作った仕事（重ね切りのフラッシュを含む）で、
// ギロチンで切れる配置か・材料ごとの片の数が合うか・固定と固定の外しをくり返しても合うかを確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { canStack, stackKey } from '../engine/packing/stack'
import { frozenDemand, frozenSheetViews, materialSummaries } from '../engine/progress/frozen'
import type { Board, CutStep, Flush, Job, MaterialResult, Part, PartGrain, Rect, SheetLayout } from '../engine/types'
import { defaultSettings } from '../engine/defaults'
import { setPieceCheck, type OpResult } from './jobs'

const NOW = new Date('2026-09-27T09:00:00.000Z')

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = ReturnType<typeof rng>
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pickOne = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]

const SIZES: Pick<Board, 'sizeKind' | 'width' | 'length' | 'grain'>[] = [
  { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' },
  { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' },
  { sizeKind: 'custom', width: 910, length: 1820, grain: 'long' },
  { sizeKind: 'custom', width: 910, length: 1820, grain: 'short' },
]

function randomJob(r: Rand, seed: number, bigger = false): Job {
  const boards: Board[] = [
    ['メラミン', 1],
    ['ラワン', 2.5],
    ['ラワン', 4],
    ['ラワン', 5.5],
  ].map(([material, thickness], i) => ({
    id: `b${i}`,
    material: material as string,
    thickness: thickness as number,
    // 多くは 3×6 にそろえ、ときどきずらす（そろわない組を作る）
    ...(r() < 0.75 ? SIZES[0] : pickOne(r, SIZES)),
  }))
  const flushes: Flush[] = []
  for (let i = 0; i < int(r, 1, 3); i++) {
    const n = r() < 0.8 ? 2 : int(r, 1, 3)
    const ids = [...boards.map((b) => b.id)].sort(() => r() - 0.5).slice(0, n)
    const count = int(r, 1, 2)
    const faces = ids.map((boardId) => ({ boardId, count: r() < 0.85 ? count : int(r, 1, 2) }))
    const f: Flush = { id: `f${i}`, name: `フラッシュ${i}`, core: int(r, 10, 20), faces }
    if (canStack(f) && r() < 0.8) f.stack = true
    flushes.push(f)
  }
  const parts: Part[] = []
  const n = bigger ? int(r, 45, 60) : int(r, 4, 14)
  for (let i = 0; i < n; i++) {
    const flush = r() < 0.7 ? pickOne(r, flushes) : null
    const board = flush ? null : pickOne(r, boards)
    parts.push({
      id: `p${i}`,
      name: `部材${i}`,
      boardId: board?.id ?? null,
      ...(flush ? { flushId: flush.id } : {}),
      expr: { W: String(int(r, 60, 1100)), H: String(int(r, 60, 1900)), D: `{t:${flush?.id ?? board!.id}}` },
      thicknessAxis: 'D',
      quantity: int(r, 1, bigger ? 6 : 3),
      grain: pickOne<PartGrain>(r, ['W', 'H', 'any']),
      memo: '',
      checks: { finished: false, cut: false },
      allowance: null,
    })
  }
  const settings = defaultSettings()
  settings.kerf = pickOne(r, [2, 3, 4])
  settings.trim = pickOne(r, [0, 5, 10])
  settings.cutMode = pickOne(r, ['vertical', 'horizontal', 'auto'] as const)
  return {
    id: `job-${seed}`,
    name: `乱数${seed}`,
    settings,
    boards,
    flushes,
    parts,
    frozenSheets: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
}

const same = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6

/** 切る順番どおりに板を2つずつに分け、最後に片がそのままの形で1つずつ残ること（ギロチン） */
function expectGuillotine(s: SheetLayout, kerf: number) {
  const whole = s.orientation === 'portrait'
    ? { x: 0, y: 0, w: s.boardWidth, h: s.boardLength }
    : { x: 0, y: 0, w: s.boardLength, h: s.boardWidth }
  let rects: Rect[] = [whole]
  s.cuts.forEach((c: CutStep) => {
    const idx = rects.findIndex((r) => same(r, c.within))
    expect(idx, `切断 ${c.no}`).toBeGreaterThanOrEqual(0)
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
    expect(p.x).toBeGreaterThanOrEqual(s.usable.x - 1e-9)
    expect(p.x + p.w).toBeLessThanOrEqual(s.usable.x + s.usable.w + 1e-9)
    expect(p.y).toBeGreaterThanOrEqual(s.usable.y - 1e-9)
    expect(p.y + p.h).toBeLessThanOrEqual(s.usable.y + s.usable.h + 1e-9)
    expect(rects.filter((r) => same(r, p)), `${p.pieceId} が切り出されていない`).toHaveLength(1)
  }
}

/** 部材×材料ごとの枚数（仕事から）。計算から除いた・入らない部材は除く */
function expected(job: Job, excluded: Set<string>): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of job.parts) {
    if (excluded.has(p.id) || p.quantity < 1) continue
    const faces = p.flushId !== undefined
      ? job.flushes.find((f) => f.id === p.flushId)!.faces
      : [{ boardId: p.boardId!, count: 1 }]
    for (const f of faces) out.set(`${p.id}|${f.boardId}`, (out.get(`${p.id}|${f.boardId}`) ?? 0) + f.count * p.quantity)
  }
  return out
}

/** 計算した1枚と固定した1枚の片を、部材×材料ごとに数える（組の1枚は両方の材料に） */
function placed(job: Job, materials: MaterialResult[]): Map<string, number> {
  const out = frozenDemand(job)
  for (const m of materials) {
    const ids = m.stack ? m.stack.boardIds : [m.boardId]
    for (const s of m.sheets) {
      for (const p of s.placements) for (const b of ids) out.set(`${p.partId}|${b}`, (out.get(`${p.partId}|${b}`) ?? 0) + 1)
    }
  }
  return out
}

function checkJob(job: Job) {
  const dims = computeDimensions(job)
  const r = packJob(job, dims)
  const excluded = new Set([...r.skipped.map((s) => s.partId), ...r.materials.flatMap((m) => m.unplaced.map((u) => u.partId))])
  const got = placed(job, r.materials)
  for (const k of [...got.keys()]) if (excluded.has(k.split('|')[0])) got.delete(k)
  expect(Object.fromEntries(got)).toEqual(Object.fromEntries(expected(job, excluded)))
  for (const m of r.materials) {
    const ids = m.sheets.flatMap((s) => s.placements.map((p) => p.pieceId))
    expect(new Set(ids).size, `${m.boardId} の片の id`).toBe(ids.length)
    for (const s of m.sheets) expectGuillotine(s, job.settings.kerf)
    if (m.stack) {
      const [a, b] = m.stack.boardIds.map((id) => job.boards.find((x) => x.id === id)!)
      expect([a.width, a.length, a.grain]).toEqual([b.width, b.length, b.grain])
    }
  }
  // まとめ（第2.1版）：材料の行の枚数 ＝ その材料のふつうの 固定（切り終わりを除く）＋計算 だけ（組の1枚は足さない）。
  // 組の行の枚数 ＝ その組の 固定（切り終わりを除く）＋計算。全体の歩留まりの枚数には組の1枚を2回数える
  const views = frozenSheetViews(job, dims)
  const sum = materialSummaries(job, r, views)
  for (const row of sum.materials) {
    const id = row.boardId
    const own = (v: (typeof views)[number]) =>
      row.stack ? v.sheet.stackWith !== undefined && stackKey(v.sheet.boardId, v.sheet.stackWith.boardId) === id : !v.sheet.stackWith && v.sheet.boardId === id
    const count =
      views.filter((v) => !v.complete && own(v)).length +
      r.materials.filter((m) => m.boardId === id && (row.stack ? m.stack !== undefined : m.stack === undefined)).reduce((n, m) => n + m.sheetCount, 0)
    expect(row.sheetCount, id).toBe(count)
    expect(row.stackedCount, id).toBe(row.stack ? row.sheetCount : 0)
  }
  return r
}

const ok = (x: OpResult): Job => {
  if (!x.ok) throw new Error(x.message)
  return x.job
}

describe('重ね切りの負荷・つじつま（乱数の仕事）', () => {
  it('乱数の仕事 150 件：ギロチンで切れる・材料ごとの片の数が合う・組の2つはサイズがそろっている', () => {
    let stacked = 0
    let mismatched = 0
    for (let seed = 1; seed <= 150; seed++) {
      const job = randomJob(rng(seed), seed)
      const r = checkJob(job)
      stacked += r.materials.filter((m) => m.stack).length
      mismatched += r.stackMismatches.length
    }
    // 組のある仕事・そろわない組のある仕事の両方を試していること
    expect(stacked).toBeGreaterThan(30)
    expect(mismatched).toBeGreaterThan(3)
  })

  it('固定・チェック・外す・重ね切りのオンオフをくり返しても片の数が合い、全部外すと最初の結果に戻る', () => {
    let frozenStacks = 0
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed * 7919)
      const start = randomJob(r, seed)
      const first = packJob(start, computeDimensions(start))
      let job = start
      let n = 0
      for (let step = 0; step < 25; step++) {
        const res = packJob(job, computeDimensions(job))
        const roll = r()
        if (roll < 0.45 && res.materials.some((m) => m.sheets.length > 0)) {
          // 計算した1枚の片にチェック（固定）
          const m = pickOne(r, res.materials.filter((x) => x.sheets.length > 0))
          const layout = pickOne(r, m.sheets)
          const target = m.stack
            ? ({ kind: 'computed', boardId: m.stack.boardIds[0], stackWith: m.stack.boardIds[1], mode: m.mode, layout } as const)
            : ({ kind: 'computed', boardId: m.boardId, mode: m.mode, layout } as const)
          job = ok(setPieceCheck(job, target, pickOne(r, layout.placements).pieceId, true, NOW, `s${n++}`))
          if (m.stack) frozenStacks++
        } else if (roll < 0.85 && job.frozenSheets.length > 0) {
          // 固定した1枚の片を付け外し（全部付けると切り終わり、全部外すと固定が外れる）
          const sheet = pickOne(r, job.frozenSheets)
          const p = pickOne(r, sheet.layout.placements).pieceId
          job = ok(setPieceCheck(job, { kind: 'frozen', sheetId: sheet.id }, p, !sheet.checked.includes(p), NOW))
        } else if (job.flushes.length > 0) {
          // 重ね切りのオン・オフ（条件に合うときだけオン）
          const i = int(r, 0, job.flushes.length - 1)
          const f = job.flushes[i]
          const { stack: _s, ...rest } = f
          const next: Flush = f.stack ? rest : canStack(f) ? { ...f, stack: true } : f
          job = { ...job, flushes: job.flushes.map((x, j) => (j === i ? next : x)) }
        }
        checkJob(job)
      }
      // 固定を全部外し、重ね切りを最初に戻すと、最初の結果と同じ
      for (const sheet of [...job.frozenSheets]) {
        for (const p of sheet.checked) {
          job = ok(setPieceCheck(job, { kind: 'frozen', sheetId: sheet.id }, p, false, NOW))
        }
      }
      expect(job.frozenSheets).toEqual([])
      job = { ...job, flushes: start.flushes }
      expect(packJob(job, computeDimensions(job))).toEqual(first)
    }
    expect(frozenStacks).toBeGreaterThan(20)
  })

  it('部材 100 枚超（重ね切りあり）でも 1 件 2 秒以内', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const job = randomJob(rng(seed * 104729), seed, true)
      const dims = computeDimensions(job)
      const t = performance.now()
      const r = packJob(job, dims)
      const pieces = r.materials.reduce((n, m) => n + m.sheets.reduce((k, s) => k + s.placements.length, 0), 0)
      expect(pieces).toBeGreaterThan(100)
      expect(performance.now() - t).toBeLessThan(2000)
    }
  })
})

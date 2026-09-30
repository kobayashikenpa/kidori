// 重ね切りの負荷・つじつまの確認：乱数で作った仕事（重ね切りのフラッシュを含む）で、
// ギロチンで切れる配置か・材料ごとの片の数が合うか・固定と固定の外しをくり返しても合うかを確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import type { LegacyFlush } from '../engine/migrate/flushCore'
import { canStack, cutFaces, stackKey, stackPlan } from '../engine/packing/stack'
import { frozenDemand, frozenSheetViews, materialSummaries } from '../engine/progress/frozen'
import { findStackSheet, stackChoice, usesStock } from '../engine/packing/stock'
import type { Board, CutStep, Job, MaterialResult, Part, PartGrain, Rect, SheetLayout, StackSheet } from '../engine/types'
import { defaultSettings } from '../engine/defaults'
import { setPieceCheck, type OpResult } from './jobs'
import { sanitizeJobs } from './storage'
import golden from './fixtures/v22StackGolden.json'
import { round1 } from '../engine/round'
import type { PackingResult } from '../engine/types'
import { dropAddedBuiltIns } from './fixtures/builtIns'

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

/**
 * legacy：第2.2版の作り方（組の設定を作らない＝乱数を使わない。v22StackGolden.json と同じ仕事になる）。
 * フラッシュの芯材は、legacy なら以前の形（core）、そうでなければ 芯材◯（木取りしない）の材料と中身の先頭の1行（第2.5版）。
 * どちらも乱数の使い方は同じ
 */
function randomJob(r: Rand, seed: number, bigger = false, legacy = false): Job {
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
  const flushes: LegacyFlush[] = []
  const coreBoards: Board[] = []
  const coreOf = (t: number): string => {
    let b = coreBoards.find((x) => x.thickness === t)
    if (!b) {
      b = { id: `core-${t}`, material: '芯材', thickness: t, ...SIZES[1], noCut: true }
      coreBoards.push(b)
    }
    return b.id
  }
  for (let i = 0; i < int(r, 1, 3); i++) {
    const n = r() < 0.8 ? 2 : int(r, 1, 3)
    const ids = [...boards.map((b) => b.id)].sort(() => r() - 0.5).slice(0, n)
    const count = int(r, 1, 2)
    const faces = ids.map((boardId) => ({ boardId, count: r() < 0.85 ? count : int(r, 1, 2) }))
    const core = int(r, 10, 20)
    const f: LegacyFlush = legacy
      ? { id: `f${i}`, name: `フラッシュ${i}`, core, faces }
      : { id: `f${i}`, name: `フラッシュ${i}`, faces: [{ boardId: coreOf(core), count: 1 }, ...faces] }
    if (canStack(f, [...boards, ...coreBoards]) && r() < 0.8) f.stack = true
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
  // 組の行の設定（第2.3版）：組ごとに、ときどき行を作る（無ければ 4×8）。大きさはでたらめ、ときどき手持ち。a・b の並びもでたらめ
  const stackSheets: StackSheet[] = []
  const allBoards = [...boards, ...coreBoards]
  for (const f of legacy ? [] : flushes) {
    if (!canStack(f, allBoards) || r() < 0.3) continue
    const [c0, c1] = cutFaces(f, allBoards)
    const ids: [string, string] = r() < 0.5 ? [c0.boardId, c1.boardId] : [c1.boardId, c0.boardId]
    if (stackSheets.some((x) => x.boardIds.includes(ids[0]) && x.boardIds.includes(ids[1]))) continue
    const row: StackSheet = { boardIds: ids, ...(r() < 0.6 ? SIZES[0] : pickOne(r, SIZES)) }
    if (r() < 0.25) {
      row.stockOn = true
      row.stock = [{ id: 'st1', ...pickOne(r, SIZES.slice(0, 2)), count: int(r, 1, 4) }]
    }
    stackSheets.push(row)
  }
  const settings = defaultSettings()
  settings.kerf = pickOne(r, [2, 3, 4])
  settings.trim = pickOne(r, [0, 5, 10])
  settings.cutMode = pickOne(r, ['vertical', 'horizontal', 'auto'] as const)
  return {
    id: `job-${seed}`,
    name: `乱数${seed}`,
    settings,
    boards: allBoards,
    flushes,
    parts,
    frozenSheets: [],
    stackSheets,
    stacking: flushes.some((f) => f.stack === true) ? 'on' : 'off',
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
    // 木取りしない材料（第2.5版の芯材）の中身は片にならない
    const faces = p.flushId !== undefined
      ? cutFaces(job.flushes.find((f) => f.id === p.flushId)!, job.boards)
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
      // 組の1枚は組の行の大きさ（第2.3版。材料のサイズによらない）。組は 3×6／4×8 だけで手持ちを使わない（E-64）
      const c = stackChoice(job, m.stack.boardIds)
      expect(c.sizeKind).not.toBe('custom')
      for (const s of m.sheets) expect([s.boardWidth, s.boardLength, s.sheet]).toEqual([c.width, c.length, undefined])
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
      // 端材から取った1枚（第2.6版）は枚数に数えない
      views.filter((v) => !v.complete && own(v) && !v.sheet.layout.sheet?.offcut).length +
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
  it('乱数の仕事 150 件：ギロチンで切れる・材料ごとの片の数が合う・組の1枚は組の行の大きさ', () => {
    let stacked = 0
    let mismatched = 0
    let stockStacks = 0
    for (let seed = 1; seed <= 150; seed++) {
      const job = randomJob(rng(seed), seed)
      const r = checkJob(job)
      for (const m of r.materials) {
        if (!m.stack) continue
        stacked++
        const [a, b] = m.stack.boardIds.map((id) => job.boards.find((x) => x.id === id)!)
        // 第2.2版では重ねなかった（2つの材料のサイズがそろっていない）組も、第2.3版では組の行の大きさで重ねる
        if (a.width !== b.width || a.length !== b.length || a.grain !== b.grain) mismatched++
        // 組の行に手持ちが残っていても（読み込みで外すが）木取りは見ない（E-64）
        if (usesStock(findStackSheet(job, m.stack.boardIds) ?? { stockOn: undefined })) stockStacks++
      }
    }
    // 組のある仕事・材料のサイズがそろわない組・手持ちの組のどれも試していること
    expect(stacked).toBeGreaterThan(30)
    expect(mismatched).toBeGreaterThan(3)
    expect(stockStacks).toBeGreaterThan(3)
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
        } else {
          // 重ね切りのオン・オフ（第2.6版：仕事ごと）
          job = { ...job, stacking: job.stacking === 'on' ? 'off' : 'on' }
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
      job = { ...job, stacking: start.stacking }
      expect(packJob(job, computeDimensions(job))).toEqual(first)
    }
    expect(frozenStacks).toBeGreaterThan(20)
    // 40件 × 25回 packJob するので、ほかのテストと同時に走って重いときでも止まらないよう 20 秒まで待つ（中身の確かめは同じ）
  }, 20_000)

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

  it('第2.2版のデータの移し替え：3×6／4×8 でそろう組は組の行になる。重ね切りは外さない。重ねない仕事は第2.2版と同じ配置（S-23・S-32）', () => {
    // v22StackGolden.json は第2.2版（コミット dc8e29d）の packJob の結果の要約（legacy の乱数の仕事 150 件）
    const table = golden as Record<string, string[]>
    let unchanged = 0
    let unstackedJobs = 0
    let customCommon = 0
    for (let seed = 1; seed <= 150; seed++) {
      const legacyJob = randomJob(rng(seed), seed, false, true)
      const raw = JSON.parse(JSON.stringify(legacyJob)) as Record<string, unknown>
      delete raw.stackSheets
      delete raw.stacking
      const { jobs, fixes } = sanitizeJobs([raw])
      expect(fixes).toBe(0)
      const job = jobs[0]
      // 第2.2版の組を3つに分ける：3×6／4×8 でそろう・自由入力でそろう・そろわない
      const kinds = stackPlan(legacyJob).groups.map((g) => {
        const [a, b] = g.boardIds.map((id) => legacyJob.boards.find((x) => x.id === id)!)
        const same = round1(a.width) === round1(b.width) && round1(a.length) === round1(b.length) && a.grain === b.grain
        const kind = !same ? 'mismatch' : a.sizeKind !== 'custom' || b.sizeKind !== 'custom' ? 'standard' : 'custom'
        return { g, a, kind }
      })
      // 3×6／4×8 でそろう組だけが組の行になり、大きさは 2つの材料の大きさ
      expect(job.stackSheets.map((x) => x.boardIds)).toEqual(kinds.filter((k) => k.kind === 'standard').map((k) => k.g.boardIds))
      for (const x of job.stackSheets) {
        const a = job.boards.find((b) => b.id === x.boardIds[0])!
        expect(x.sizeKind).not.toBe('custom')
        expect([x.width, x.length, x.grain]).toEqual([a.width, a.length, a.grain])
      }
      // 仕事の重ね切り：部材が使っている材料グループで、以前の決まりで重ねられたのに外していたものがあれば off（18.8）
      const used = new Set(legacyJob.parts.filter((p) => p.quantity >= 1).map((p) => p.flushId))
      const wantOff = job.flushes.some((f) => used.has(f.id) && f.stack !== true && canStack(f, job.boards))
      expect(job.stacking).toBe(wantOff ? 'off' : 'on')
      // 芯材（core）は 芯材◯（木取りしない）の材料と中身の先頭に移る（第2.5版）。戻すと第2.2版と同じ
      const cores = new Map(job.boards.filter((b) => b.noCut).map((b) => [b.id, b.thickness]))
      const back = job.flushes.map(({ form: _f, autoName: _a, ...f }) => ({
        ...f,
        core: cores.get(f.faces[0].boardId),
        faces: f.faces.slice(1),
      }))
      expect(back).toEqual(legacyJob.flushes)
      expect(dropAddedBuiltIns(job, legacyJob).boards.filter((b) => !b.noCut)).toEqual(legacyJob.boards)
      if (kinds.some((k) => k.kind !== 'standard')) unstackedJobs++
      const r = checkJob(job)
      if (kinds.some((k) => k.kind === 'custom')) customCommon++
      if (kinds.length === 0 && r.materials.every((m) => !m.stack)) {
        // 第2.6版：組も端材も変わるので、第2.2版と同じ配置になるのは、第2.2版でも今も重ねていない仕事だけ。
        // 第2.5版（E-68）で帯の並べ方（同じ幅を優先）を変えたので、第2.2版と比べるのは第2.4版までの並べ方で並べた結果
        // 重ねない仕事なので組は使わない（plan は空）。並べ方を変えると確かめ（decideStacks）の結果が変わりうるため（E-79 で組のサイズの初期値が変わり seed 114 で起きた）
        const old = packJob(job, computeDimensions(job), [], { sameWidthFirst: false })
        expect(digest(old), `seed ${seed}`).toEqual(table[`s${seed}`])
        unchanged++
      }
    }
    expect(unchanged).toBeGreaterThan(3)
    expect(unstackedJobs).toBeGreaterThan(3)
    // 自由入力どうしでそろう組は乱数ではほぼ出ない（stackStorage.test.ts で確かめる）
    expect(customCommon).toBeGreaterThanOrEqual(0)
  })
})

/** 結果の要約（第2.2版の結果と比べる。v22StackGolden.json は第2.2版のコードでこの関数と同じ作り方で作った） */
function digest(r: PackingResult): string[] {
  const fnv = (s: string) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(36)
  }
  return r.materials.map((m) => {
    const body = JSON.stringify([
      m.mode,
      m.sheets.map((s) => [s.boardWidth, s.boardLength, s.sheet?.stockId ?? null, s.placements.map((p) => [p.pieceId, round1(p.x), round1(p.y), round1(p.w), round1(p.h)])]),
      m.unplaced,
    ])
    return `${m.boardId}|${m.sheetCount}|${fnv(body)}`
  })
}

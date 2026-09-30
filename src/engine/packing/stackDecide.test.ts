// E-74（第2.6版。architecture.md 18.5）：重ねると材料が増える組は重ねない（decideStacks）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { BETA20, FLUSH25, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import type { Job, PackingResult } from '../types'
import { decideStacks, packJob } from './index'
import { pairCandidates } from './pairing'
import { expandPieces } from './pieces'
import { stackKey } from './stack'

const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const
const run = (job: Job) => packJob(job, computeDimensions(job))
const keysOf = (job: Job) => pairCandidates(job, expandPieces(job, computeDimensions(job))).map((c) => c.key)
/** 材料 id の枚数（その材料を含む重ねた板 ＋ 材料の行の1枚。端材の1枚を除く） */
const count = (r: PackingResult, id: string) =>
  r.materials.filter((m) => m.boardId === id || m.stack?.boardIds.includes(id)).reduce((n, m) => n + m.sheetCount, 0)
const area = (r: PackingResult, id: string) =>
  r.materials
    .filter((m) => m.boardId === id || m.stack?.boardIds.includes(id))
    .flatMap((m) => m.sheets.filter((s) => !s.sheet?.offcut))
    .reduce((n, s) => n + s.boardWidth * s.boardLength, 0)

describe('decideStacks', () => {
  it('組の行 4×8・ラワン4 の材料の行 3×6 で、重ねると ラワン4 が1枚増える組は rejected、結果は重ね切りオフと同じ', () => {
    // 棚（長手 300・妻手 900。木目は長手）は重ねた板 4×8 の端材（幅 762）に入らず、3×6 の新しい板が要る（E-78 で端材を先に使うようになったので形を変えた）
    const job = stackJob([groupPart('天板', FLUSH25, 600, 450, 1), boardPart('棚', L4, 300, 900, 1)])
    job.stackSheets = [{ boardIds: [MEL, L4], ...S48 }]
    const dims = computeDimensions(job)
    // すべて重ねると ラワン4 が 2枚（オフは 1枚）
    const all = packJob(job, dims, keysOf(job))
    const off = packJob({ ...job, stacking: 'off' }, dims)
    expect([count(all, L4), count(off, L4)]).toEqual([2, 1])
    const pair = { key: stackKey(MEL, L4), boardIds: [MEL, L4] }
    expect(decideStacks(job, dims)).toEqual({ accepted: [], rejected: [pair] })
    const r = packJob(job, dims)
    expect(r.stacks).toEqual({ accepted: [], rejected: [pair] })
    expect(r.materials).toEqual(off.materials)
    expect(r.totalYieldRate).toBe(off.totalYieldRate)
  })

  it('板が増えない組は採る（見本の組）', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 2)])
    expect(decideStacks(job, computeDimensions(job))).toEqual({ accepted: [{ key: stackKey(MEL, L4), boardIds: [MEL, L4] }], rejected: [] })
  })

  it('候補の組が2つで1つだけ増える仕事：増える組（メラミン1＋ラワン18）だけ rejected', () => {
    const job = stackJob([groupPart('g0', BETA20, 1500, 300, 1), groupPart('g1', FLUSH25, 1400, 600, 1), boardPart('d0', L4, 700, 700, 1)])
    const d = decideStacks(job, computeDimensions(job))
    expect(d.accepted.map((p) => p.key)).toEqual([stackKey(MEL, L4)])
    expect(d.rejected.map((p) => p.key)).toEqual([stackKey(MEL, L18)])
    const r = run(job)
    const off = run({ ...job, stacking: 'off' })
    for (const id of [MEL, L4, L18]) expect(count(r, id)).toBeLessThanOrEqual(count(off, id))
  })

  it('枚数が同じで面積が増える組は rejected（組の行 4×8：重ねなければ メラミン1・ラワン4 とも 3×6 1枚）', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 450, 1)])
    job.stackSheets = [{ boardIds: [MEL, L4], ...S48 }]
    const dims = computeDimensions(job)
    const all = packJob(job, dims, keysOf(job))
    const off = packJob({ ...job, stacking: 'off' }, dims)
    expect([count(all, MEL), count(off, MEL)]).toEqual([1, 1])
    expect(area(all, MEL)).toBeGreaterThan(area(off, MEL))
    expect(run(job).stacks.rejected.map((p) => p.key)).toEqual([stackKey(MEL, L4)])
    // 組の行が無ければ（2つの材料が 3×6 なので組も 3×6）面積も同じなので重ねる
    job.stackSheets = []
    expect(run(job).stacks.accepted.map((p) => p.key)).toEqual([stackKey(MEL, L4)])
  })

  it('どの材料もオフより枚数が多くならない・入らない片も増えない（乱数の仕事 300 件）', () => {
    let s = 7
    const r = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648)
    let rejected = 0
    for (let seed = 0; seed < 300; seed++) {
      const parts = []
      const n = 1 + Math.floor(r() * 3)
      for (let i = 0; i < n; i++) parts.push(groupPart(`g${i}`, r() < 0.5 ? BETA20 : FLUSH25, 200 + Math.floor(r() * 16) * 100, 100 + Math.floor(r() * 8) * 100, 1 + Math.floor(r() * 2)))
      const m = Math.floor(r() * 3)
      for (let i = 0; i < m; i++) parts.push(boardPart(`d${i}`, [L18, MEL, L4][Math.floor(r() * 3)], 200 + Math.floor(r() * 16) * 100, 100 + Math.floor(r() * 8) * 100, 1 + Math.floor(r() * 2)))
      const job = stackJob(parts)
      if (r() < 0.5) job.stackSheets = [{ boardIds: [MEL, L18], ...S48 }, { boardIds: [MEL, L4], ...S48 }]
      const on = run(job)
      const off = run({ ...job, stacking: 'off' })
      rejected += on.stacks.rejected.length
      const unplaced = (x: PackingResult, id: string) => x.materials.filter((mm) => mm.boardId === id || mm.stack?.boardIds.includes(id)).reduce((k, mm) => k + mm.unplaced.length, 0)
      for (const id of [MEL, L4, L18]) {
        expect(count(on, id), `seed ${seed} ${id}`).toBeLessThanOrEqual(count(off, id))
        expect(unplaced(on, id)).toBeLessThanOrEqual(unplaced(off, id))
      }
    }
    expect(rejected).toBeGreaterThan(10)
  }, 30_000)

  it('部材 150枚・組の候補 4 で packJob（確かめ込み）が 1秒以内', () => {
    const job = stackJob([])
    job.flushes.push({ id: 'g-ml18', name: 'x', faces: [{ boardId: L4, count: 1 }, { boardId: L18, count: 1 }] })
    const parts = []
    for (let i = 0; i < 10; i++) {
      parts.push(groupPart(`f${i}`, FLUSH25, 300 + i * 53, 200 + i * 29, 2, 'any'))
      parts.push(groupPart(`b${i}`, BETA20, 250 + i * 61, 150 + i * 31, 2, 'any'))
      parts.push(groupPart(`c${i}`, 'g-abc', 400 + i * 47, 120 + i * 17, 1, 'any'))
      parts.push(boardPart(`d${i}`, i % 2 ? L18 : MEL, 200 + i * 41, 60 + i * 11, 3, 'any'))
    }
    job.parts = parts
    const dims = computeDimensions(job)
    expect(keysOf(job).length).toBeGreaterThanOrEqual(4)
    const t = performance.now()
    const r = packJob(job, dims)
    const took = performance.now() - t
    const pieces = r.materials.reduce((n, m) => n + m.sheets.reduce((k, x) => k + x.placements.length, 0), 0)
    expect(pieces).toBeGreaterThan(150)
    expect(took).toBeLessThan(1000)
  }, 10_000)
})

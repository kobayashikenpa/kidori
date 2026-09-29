// E-71（第2.6版。architecture.md 18.3）：組を作る（材料グループの部材の、違う材料の同じ片どうし）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob } from '../fixtures/bookshelf'
import { sampleGroupJob } from '../fixtures/flush'
import { A, ABC, B, BETA20, C, FLUSH25, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import type { FrozenSheet, Job, SheetLayout } from '../types'
import { pairCandidates, remainingRuns } from './pairing'
import { expandPieces } from './pieces'
import { stackKey } from './stack'

const cands = (job: Job) => pairCandidates(job, expandPieces(job, computeDimensions(job)))
const summary = (job: Job) => cands(job).map((c) => ({ key: c.key, boardIds: c.boardIds, n: c.pairs.length }))

/** 材料 boardId の残りの片の数（組にしなかった片） */
function restOf(job: Job, boardId: string): number {
  const ex = expandPieces(job, computeDimensions(job))
  return remainingRuns(ex.runs, pairCandidates(job, ex))
    .filter((r) => r.boardId === boardId)
    .reduce((n, r) => n + r.count, 0)
}

describe('pairCandidates（組を作る）', () => {
  it('フラッシュ25（メラミン1×2・ラワン4×2）の側板 2枚 → 組（メラミン1＋ラワン4）4', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 2)])
    expect(summary(job)).toEqual([{ key: stackKey(MEL, L4), boardIds: [MEL, L4], n: 4 }])
    expect(restOf(job, MEL)).toBe(0)
    expect(restOf(job, L4)).toBe(0)
  })

  it('組の片は a の片（片の id は a の番号）と b の片。寸法は同じ', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 1)])
    const [c] = cands(job)
    expect(c.pairs.map((p) => p.a.pieceId)).toEqual(['側板#1', '側板#2'])
    expect(c.pairs.map((p) => p.b.pieceId)).toEqual(['側板#3', '側板#4'])
    expect(c.pairs.every((p) => p.a.sizeLabel === p.b.sizeLabel)).toBe(true)
    expect(c.pairs[0].a.orientations.length).toBeGreaterThan(0)
  })

  it('ベタ20（ラワン18×1・メラミン1×2）の側板 2枚 → 組（メラミン1＋ラワン18）2・メラミン1 の残り 2', () => {
    const job = stackJob([groupPart('側板', BETA20, 1800, 800, 2)])
    expect(summary(job)).toEqual([{ key: stackKey(MEL, L18), boardIds: [MEL, L18], n: 2 }])
    expect(restOf(job, MEL)).toBe(2)
    expect(restOf(job, L18)).toBe(0)
  })

  it('中身 A×1・B×1・C×2 の部材 1枚 → 組 A＋C・B＋C（残りなし）', () => {
    const job = stackJob([groupPart('板', ABC, 800, 400, 1)])
    expect(summary(job)).toEqual([
      { key: stackKey(A, C), boardIds: [A, C], n: 1 },
      { key: stackKey(B, C), boardIds: [B, C], n: 1 },
    ])
    expect(restOf(job, A) + restOf(job, B) + restOf(job, C)).toBe(0)
  })

  it('材料を直接選んだ 1800×800 の部材 3枚 → 組なし（同じ材料どうしは重ねない）', () => {
    const job = stackJob([boardPart('棚', L18, 1800, 800, 3)])
    expect(cands(job)).toEqual([])
    expect(restOf(job, L18)).toBe(3)
  })

  it('本棚の見本 → 組なし', () => {
    expect(cands(bookshelfJob())).toEqual([])
  })

  it('違う部材・違うフラッシュでも、メラミン1＋ラワン4 は1つの組にまとまる', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 1), groupPart('天板', FLUSH25, 900, 400, 1)])
    job.flushes.push({ id: 'g-other', name: 'フラッシュ25B', faces: [{ boardId: L4, count: 1 }, { boardId: MEL, count: 1 }] })
    job.parts.push(groupPart('扉', 'g-other', 600, 400, 1))
    // g-other の厚みは 5（式の厚みが合うように）
    const c = cands(job)
    expect(c.map((x) => x.key)).toEqual([stackKey(MEL, L4)])
    expect(c[0].pairs.length).toBe(2 + 2 + 1)
  })

  it('組の並びは a の保存の並び → b の保存の並び', () => {
    const job = stackJob([groupPart('板', ABC, 800, 400, 1), groupPart('側板', BETA20, 1800, 800, 1), groupPart('天板', FLUSH25, 900, 400, 1)])
    expect(cands(job).map((c) => c.key)).toEqual([stackKey(MEL, L4), stackKey(MEL, L18), stackKey(A, C), stackKey(B, C)])
  })

  it('固定した片を引いた残りで組を作る（メラミン1 の側板 1つを固定 → 組 3・ラワン4 の残り 1）', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 2)])
    const layout = { placements: [{ pieceId: '側板#1', partId: '側板', name: '側板', x: 0, y: 0, w: 800, h: 1800, rotated: false, sizeLabel: '1800×800' }] } as unknown as SheetLayout
    job.frozenSheets = [{ id: 'f1', boardId: MEL, material: 'メラミン', thickness: 1, grain: 'long', mode: 'vertical', kerf: 3, trim: 5, layout, checked: [], frozenAt: '2026-01-01T00:00:00.000Z' } as FrozenSheet]
    expect(summary(job)).toEqual([{ key: stackKey(MEL, L4), boardIds: [MEL, L4], n: 3 }])
    expect(restOf(job, L4)).toBe(1)
    expect(restOf(job, MEL)).toBe(0)
  })

  it('組の行のサイズに入らない片は組にしない（3×6 の組に 2000×800 は入らない。4×8 の行なら組にする）', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 2000, 800, 1)])
    expect(cands(job)).toEqual([])
    job.stackSheets = [{ boardIds: [MEL, L4], sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' }]
    expect(summary(job)).toEqual([{ key: stackKey(MEL, L4), boardIds: [MEL, L4], n: 2 }])
  })

  it('重ね切りオフなら候補なし', () => {
    expect(cands(stackJob([groupPart('側板', FLUSH25, 1800, 800, 2)], 'off'))).toEqual([])
  })

  it('見本（フラッシュ25 の天地板・側板・棚板）は メラミン1＋ラワン4 の組 16、背板は組にならない', () => {
    const job = sampleGroupJob(true)
    const c = cands(job)
    expect(c.map((x) => x.pairs.length)).toEqual([16])
  })
})

// 第2.5版（E-66）：木取りしない材料と、材料グループの中身の合計の厚み・片・重ね切り
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { CORE_15_ID, LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob, sampleGroupJob, flushPart } from '../fixtures/flush'
import { cutFaces, defaultFlushStack, flushBreakdown, flushThickness, partIsNoCut } from '../flush'
import { materialSummaries, frozenSheetViews } from '../progress/frozen'
import type { Job } from '../types'
import { packJob } from './index'
import { expandPieces } from './pieces'
import { canStack, stackKey } from './stack'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const pct = (r: number) => Math.round(r * 1000) / 10
const LAUAN_18_ID = 'board-lauan-18'

function summaries(job: Job) {
  const dims = computeDimensions(job)
  return materialSummaries(job, packJob(job, dims), frozenSheetViews(job, dims))
}
const expand = (job: Job) => expandPieces(job, computeDimensions(job))
const idsOf = (job: Job, boardId: string, partId: string) =>
  expand(job)
    .groups.filter((g) => g.board.id === boardId)
    .flatMap((g) => g.pieces.filter((p) => p.partId === partId).map((p) => p.pieceId))

/** 見本の材料に ラワン18 を足し、ベタ20（ラワン18×1・メラミン1×2）の側板 2枚だけの仕事 */
function betaJob(): Job {
  const job = sampleGroupJob(false)
  const sheet = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
  job.boards.push({ id: LAUAN_18_ID, material: 'ラワン', thickness: 18, ...sheet })
  job.flushes.push({
    id: 'flush-beta-20',
    name: 'ベタ20',
    faces: [
      { boardId: LAUAN_18_ID, count: 1 },
      { boardId: MELAMINE_1_ID, count: 2 },
    ],
    form: 'beta',
    autoName: true,
  })
  job.parts = [
    flushPart({ id: 'p-gawa', name: '側板', flushId: 'flush-beta-20', expr: { W: '20', H: '1800', D: '400' }, quantity: 2, grain: 'H' }),
  ]
  return job
}

describe('中身の合計の厚み（木取りしない材料も数える）', () => {
  it('芯材15（木取りしない）×1・メラミン1×2・ラワン4×2 は 25（core なし）', () => {
    const job = sampleGroupJob()
    expect(flushThickness(job.flushes[0], job.boards)).toBe(25)
  })
  it('内訳の中身に芯材15 も入り、noCut が添えられる', () => {
    const b = flushBreakdown(sampleGroupJob(), sampleGroupJob().flushes[0].id)!
    expect(b.total).toBe(25)
    expect(b.faces.map((f) => [f.label, f.count, f.noCut])).toEqual([
      ['芯材15', 1, true],
      ['メラミン1', 2, false],
      ['ラワン4', 2, false],
    ])
  })
  it('cutFaces は木取りする中身だけ（中身の並びのまま）', () => {
    const job = sampleGroupJob()
    expect(cutFaces(job.flushes[0], job.boards).map((f) => f.boardId)).toEqual([MELAMINE_1_ID, LAUAN_4_ID])
  })
})

describe('重ね切りの見本（材料グループの形）は以前と同じ結果', () => {
  it('組 3×6 で5枚 85.2%・ラワン4 の1枚 97.8%・全体 86.4%', () => {
    const s = summaries(sampleGroupJob(true))
    expect(s.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 97.8],
    ])
    expect(pct(s.totalYieldRate)).toBe(86.4)
  })
  it('配置は core のある以前の形と1片も違わない（重ね切りオン・オフ）', () => {
    for (const stack of [true, false]) {
      const a = packJob(sampleFlushJob(stack), computeDimensions(sampleFlushJob(stack)))
      const b = packJob(sampleGroupJob(stack), computeDimensions(sampleGroupJob(stack)))
      expect(b).toEqual(a)
    }
  })
  it('片の id：メラミン1 #1〜#4・ラワン4 #5〜#8（芯材が中身の先頭でも）', () => {
    const job = sampleGroupJob(false)
    expect(idsOf(job, MELAMINE_1_ID, 'part-gawa')).toEqual(['part-gawa#1', 'part-gawa#2', 'part-gawa#3', 'part-gawa#4'])
    expect(idsOf(job, LAUAN_4_ID, 'part-gawa')).toEqual(['part-gawa#5', 'part-gawa#6', 'part-gawa#7', 'part-gawa#8'])
  })
  it('芯材15 の片は出ない', () => {
    expect(expand(sampleGroupJob()).groups.some((g) => g.board.id === CORE_15_ID)).toBe(false)
  })
  it('canStack・defaultFlushStack は木取りする中身で判定する', () => {
    const job = sampleGroupJob()
    expect(canStack(job.flushes[0], job.boards)).toBe(true)
    expect(defaultFlushStack(job.flushes[0].faces, job.boards)).toBe(true)
  })
  it('芯材15 を木取りする材料にすると 芯材15 の片が出て、canStack が false（組は無くなる）', () => {
    const job = sampleGroupJob(true)
    delete job.boards.find((b) => b.id === CORE_15_ID)!.noCut
    expect(canStack(job.flushes[0], job.boards)).toBe(false)
    const g = expand(job).groups
    expect(g.some((x) => x.board.id === CORE_15_ID)).toBe(true)
    expect(g.some((x) => x.stack)).toBe(false)
    expect(idsOf(job, CORE_15_ID, 'part-gawa')).toEqual(['part-gawa#1', 'part-gawa#2'])
  })
})

describe('ベタ20（ラワン18×1・メラミン1×2。全部木取りする）', () => {
  it('側板 2枚 → ラワン18 の片2・メラミン1 の片4', () => {
    const g = expand(betaJob()).groups
    expect(g.map((x) => [x.board.id, x.pieces.length])).toEqual([
      [MELAMINE_1_ID, 4],
      [LAUAN_18_ID, 2],
    ])
  })
  it('枚数が違うので canStack は false・重ね切りの初期値もオフ', () => {
    const job = betaJob()
    expect(canStack(job.flushes[1], job.boards)).toBe(false)
    expect(defaultFlushStack(job.flushes[1].faces, job.boards)).toBe(false)
  })
  it('切り代 10 が足される（1800 → 1810）', () => {
    const d = computeDimensions(betaJob()).parts[0]
    expect(d.cutSize?.H).toBe(1810)
  })
})

describe('木取りしない材料だけの部材', () => {
  it('芯材15 を直接選んだ部材は片が無く、skipped・done にも出ない', () => {
    const job = sampleGroupJob()
    job.parts.push(flushPart({ id: 'p-san', name: '桟', boardId: CORE_15_ID, expr: { W: '900', H: '15', D: '40' }, quantity: 2 }))
    job.parts.push(flushPart({ id: 'p-san2', name: '桟2', boardId: CORE_15_ID, expr: { W: '900', H: '15', D: '40' }, quantity: 1, checks: { finished: false, cut: true } }))
    const r = expand(job)
    expect(partIsNoCut(job, job.parts.at(-1)!)).toBe(true)
    expect(r.groups.flatMap((g) => g.pieces).some((p) => p.partId.startsWith('p-san'))).toBe(false)
    expect(r.skipped).toEqual([])
    expect(r.done).toEqual([])
  })
  it('中身が芯材15 だけの材料グループの部材も同じ', () => {
    const job = sampleGroupJob()
    job.flushes.push({ id: 'g-core', name: 'グループ15', faces: [{ boardId: CORE_15_ID, count: 1 }], form: 'empty', autoName: true })
    job.parts.push(flushPart({ id: 'p-waku', name: '枠', flushId: 'g-core', expr: { W: '900', H: '15', D: '40' }, quantity: 2 }))
    expect(partIsNoCut(job, job.parts.at(-1)!)).toBe(true)
    const r = expand(job)
    expect(r.groups.flatMap((g) => g.pieces).some((p) => p.partId === 'p-waku')).toBe(false)
    expect(r.skipped).toEqual([])
    expect(r.done).toEqual([])
  })
  it('ふつうの部材・材料グループの部材は partIsNoCut が false', () => {
    const job = sampleGroupJob()
    expect(job.parts.map((p) => partIsNoCut(job, p))).toEqual([false, false, false, false, false])
  })
  it('中身が1つも無い材料グループの部材は今までどおり noBoard', () => {
    const job = sampleGroupJob()
    job.flushes[0].faces = []
    expect(expand(job).skipped.map((s) => s.reason)).toEqual(['noBoard', 'noBoard', 'noBoard'])
  })
})

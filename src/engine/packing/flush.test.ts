import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { flushJob, flushPart, LAUAN_4_ID, MELAMINE_1_ID } from '../fixtures/flush'
import type { Job } from '../types'
import { packJob } from './index'
import { expandPieces } from './pieces'

function expand(job: Job) {
  return expandPieces(job, computeDimensions(job))
}

function pieceCount(job: Job) {
  return Object.fromEntries(expand(job).groups.map((g) => [g.board.id, g.pieces.length]))
}

describe('フラッシュの部材の木取り（表面材ごと）', () => {
  it('天板 2枚（メラミン1×2・ラワン4×2）→ メラミン1 が4枚・ラワン4 が4枚。芯材は入れない', () => {
    expect(pieceCount(flushJob())).toEqual({ [MELAMINE_1_ID]: 4, [LAUAN_4_ID]: 4 })
  })

  it('片は部材と同じ木取り寸法（910×610）で、木目 W を材料の木目（長辺）に合わせる', () => {
    const g = expand(flushJob()).groups
    for (const x of g) {
      expect(x.pieces[0].sizeLabel).toBe('910×610')
      expect(x.pieces[0].orientations).toEqual([{ x: 610, y: 910, rotated: false }])
      expect(x.pieces[0].name).toBe('天板')
    }
  })

  it('片の id は部材ごとに通し番号（表面材をまたいで重ならない）', () => {
    const ids = expand(flushJob()).groups.flatMap((g) => g.pieces.map((p) => p.pieceId))
    expect(ids).toEqual(['part-tenban#1', 'part-tenban#2', 'part-tenban#3', 'part-tenban#4',
      'part-tenban#5', 'part-tenban#6', 'part-tenban#7', 'part-tenban#8'])
  })

  it('メラミン1 を完了にすると メラミン1 だけ除かれ、木取り済みに材料つきで出る', () => {
    const job = flushJob()
    job.parts[0].checks = { finished: false, cut: false, cutByBoard: { [MELAMINE_1_ID]: true } }
    const r = expand(job)
    expect(pieceCount(job)).toEqual({ [LAUAN_4_ID]: 4 })
    expect(r.done).toEqual([{ partId: 'part-tenban', name: '天板', quantity: 4, boardId: MELAMINE_1_ID }])
    expect(r.skipped).toEqual([])
  })

  it('両方を完了にすると木取りする片は無く、木取り済みに2行', () => {
    const job = flushJob()
    job.parts[0].checks = { finished: false, cut: false, cutByBoard: { [MELAMINE_1_ID]: true, [LAUAN_4_ID]: true } }
    const r = expand(job)
    expect(r.groups).toEqual([])
    expect(r.done.map((d) => d.boardId)).toEqual([MELAMINE_1_ID, LAUAN_4_ID])
  })

  it('完了が false の表面材は除かない。フラッシュの部材では checks.cut は見ない', () => {
    const job = flushJob()
    job.parts[0].checks = { finished: false, cut: true, cutByBoard: { [MELAMINE_1_ID]: false } }
    expect(pieceCount(job)).toEqual({ [MELAMINE_1_ID]: 4, [LAUAN_4_ID]: 4 })
    expect(expand(job).done).toEqual([])
  })

  it('厚みがフラッシュと合わない（24）部材は、部材ごとに1つ thicknessMismatch で除く', () => {
    const job = flushJob()
    job.parts[0].expr.H = '24'
    const r = expand(job)
    expect(r.groups).toEqual([])
    expect(r.skipped).toEqual([{ partId: 'part-tenban', name: '天板', reason: 'thicknessMismatch' }])
  })

  it('表面材が無い（材料を削除した）フラッシュ・無いフラッシュの部材は noBoard', () => {
    const job = flushJob()
    job.flushes[0].faces = []
    expect(expand(job).skipped).toEqual([{ partId: 'part-tenban', name: '天板', reason: 'noBoard' }])
    const job2 = flushJob()
    job2.parts[0].flushId = 'なし'
    expect(expand(job2).skipped).toEqual([{ partId: 'part-tenban', name: '天板', reason: 'noBoard' }])
  })

  it('同じ材料をふつうの部材とフラッシュの表面材で使うと、同じ板で一緒に木取りする', () => {
    const job = flushJob()
    job.parts.push(flushPart({ id: 'p-back', name: '背板', boardId: LAUAN_4_ID, expr: { W: '900', H: '600', D: '4' } }))
    expect(pieceCount(job)).toEqual({ [MELAMINE_1_ID]: 4, [LAUAN_4_ID]: 5 })
  })

  it('packJob：メラミン1・ラワン4 それぞれに 910×610 が4枚ずつ並ぶ（入らない片なし）', () => {
    const r = packJob(flushJob(), computeDimensions(flushJob()))
    expect(r.materials.map((m) => [m.boardId, m.sheets.flatMap((s) => s.placements).length, m.unplaced.length])).toEqual([
      [MELAMINE_1_ID, 4, 0],
      [LAUAN_4_ID, 4, 0],
    ])
  })
})

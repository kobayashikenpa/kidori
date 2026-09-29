import { describe, expect, it } from 'vitest'
import { LAUAN_4_ID, MELAMINE_1_ID, LAUAN_25_ID, SAMPLE_FLUSH_ID, sampleGroupJob } from '../fixtures/flush'
import type { Flush } from '../types'
import { canStack, stackKey, stackLabel, stackPlan } from './stack'

const face = (boardId: string, count: number) => ({ boardId, count })
const flush = (faces: Flush['faces']): Flush => ({ id: 'f', name: 'f', faces })
const B = sampleGroupJob().boards
describe('canStack（重ねて切れるフラッシュか）', () => {
  it('メラミン1×2・ラワン4×2 は重ねられる', () => {
    expect(canStack(flush([face(MELAMINE_1_ID, 2), face(LAUAN_4_ID, 2)]), B)).toBe(true)
  })
  it('枚数が違う（メラミン1×2・ラワン4×1）、表面材が3種類・1種類、同じ材料が2つは重ねられない', () => {
    expect(canStack(flush([face(MELAMINE_1_ID, 2), face(LAUAN_4_ID, 1)]), B)).toBe(false)
    expect(canStack(flush([face(MELAMINE_1_ID, 1), face(LAUAN_4_ID, 1), face(LAUAN_25_ID, 1)]), B)).toBe(false)
    expect(canStack(flush([face(MELAMINE_1_ID, 2)]), B)).toBe(false)
    expect(canStack(flush([face(MELAMINE_1_ID, 2), face(MELAMINE_1_ID, 2)]), B)).toBe(false)
  })
})

describe('stackPlan・stackLabel（どの組を重ねるか）', () => {
  it('見本でフラッシュ25 をオンにすると組が1つ（a＝メラミン 1、b＝ラワン 4）', () => {
    const job = sampleGroupJob(true)
    const plan = stackPlan(job)
    expect(plan.groups).toEqual([
      { key: stackKey(MELAMINE_1_ID, LAUAN_4_ID), boardIds: [MELAMINE_1_ID, LAUAN_4_ID], flushIds: [SAMPLE_FLUSH_ID] },
    ])
    expect(stackKey(MELAMINE_1_ID, LAUAN_4_ID)).toBe(`stack:${MELAMINE_1_ID}+${LAUAN_4_ID}`)
    expect(stackLabel(job, [MELAMINE_1_ID, LAUAN_4_ID])).toBe('メラミン1＋ラワン4（重ね切り）')
  })

  it('表面材の並びを逆にしても組は同じ（材料の保存の並びで a・b を決める）', () => {
    const job = sampleGroupJob(true)
    job.flushes[0].faces.reverse()
    expect(stackPlan(job).groups.map((g) => g.boardIds)).toEqual([[MELAMINE_1_ID, LAUAN_4_ID]])
  })

  it('オフなら組は無い', () => {
    expect(stackPlan(sampleGroupJob(false))).toEqual({ groups: [] })
  })

  it('サイズ・手持ちは見ない（第2.3版）：ラワン 4 を 4×8・短手・手持ちにしても組は1つのまま', () => {
    const job = sampleGroupJob(true)
    job.boards = job.boards.map((b) =>
      b.id === LAUAN_4_ID
        ? { ...b, sizeKind: 'custom', width: 1220, length: 2440, grain: 'short', stockOn: true, stock: [{ id: 's', sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long', count: 1 }] }
        : b,
    )
    job.stackSheets = []
    expect(stackPlan(job)).toEqual({
      groups: [{ key: stackKey(MELAMINE_1_ID, LAUAN_4_ID), boardIds: [MELAMINE_1_ID, LAUAN_4_ID], flushIds: [SAMPLE_FLUSH_ID] }],
    })
  })

  it('同じ2つの材料で重ねるフラッシュが2つあれば1つの組にまとめる。条件に合わない・材料が無いフラッシュは入れない', () => {
    const job = sampleGroupJob(true)
    job.flushes.push(
      { id: 'f2', name: 'フラッシュ21', faces: [face(LAUAN_4_ID, 1), face(MELAMINE_1_ID, 1)], stack: true },
      { id: 'f3', name: 'x', faces: [face(LAUAN_4_ID, 1), face(MELAMINE_1_ID, 2)], stack: true },
      { id: 'f4', name: 'y', faces: [face(LAUAN_4_ID, 1), face('board-none', 1)], stack: true },
      { id: 'f5', name: 'z', faces: [face(LAUAN_25_ID, 1), face(MELAMINE_1_ID, 1)], stack: true },
    )
    const plan = stackPlan(job)
    expect(plan.groups.map((g) => [g.boardIds, g.flushIds])).toEqual([
      [[MELAMINE_1_ID, LAUAN_25_ID], ['f5']],
      [[MELAMINE_1_ID, LAUAN_4_ID], [SAMPLE_FLUSH_ID, 'f2']],
    ])
  })

  it('材料が無いときは写しの名前を使える', () => {
    const job = sampleGroupJob(true)
    job.boards = []
    expect(
      stackLabel(job, [MELAMINE_1_ID, LAUAN_4_ID], [
        { material: 'メラミン', thickness: 1 },
        { material: 'ラワン', thickness: 4 },
      ]),
    ).toBe('メラミン1＋ラワン4（重ね切り）')
  })
})

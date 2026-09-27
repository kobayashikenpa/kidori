import { describe, expect, it } from 'vitest'
import { LAUAN_4_ID, MELAMINE_1_ID, LAUAN_25_ID, SAMPLE_FLUSH_ID, sampleFlushJob } from '../fixtures/flush'
import type { Board, Flush } from '../types'
import { canStack, sameSheet, stackKey, stackLabel, stackPlan } from './stack'

const face = (boardId: string, count: number) => ({ boardId, count })
const flush = (faces: Flush['faces']): Flush => ({ id: 'f', name: 'f', core: 15, faces })
const board = (p: Partial<Board>): Board => ({
  id: 'b',
  material: 'ラワン',
  thickness: 4,
  sizeKind: 'saburoku',
  width: 910,
  length: 1820,
  grain: 'long',
  ...p,
})

describe('canStack（重ねて切れるフラッシュか）', () => {
  it('メラミン1×2・ラワン4×2 は重ねられる', () => {
    expect(canStack(flush([face(MELAMINE_1_ID, 2), face(LAUAN_4_ID, 2)]))).toBe(true)
  })
  it('枚数が違う（メラミン1×2・ラワン4×1）、表面材が3種類・1種類、同じ材料が2つは重ねられない', () => {
    expect(canStack(flush([face(MELAMINE_1_ID, 2), face(LAUAN_4_ID, 1)]))).toBe(false)
    expect(canStack(flush([face(MELAMINE_1_ID, 1), face(LAUAN_4_ID, 1), face(LAUAN_25_ID, 1)]))).toBe(false)
    expect(canStack(flush([face(MELAMINE_1_ID, 2)]))).toBe(false)
    expect(canStack(flush([face(MELAMINE_1_ID, 2), face(MELAMINE_1_ID, 2)]))).toBe(false)
  })
})

describe('sameSheet（サイズ・木目がそろっているか）', () => {
  it('3×6 と 自由入力 910×1820・長手方向 はそろう。短手方向ならそろわない。4×8 ともそろわない', () => {
    const a = board({})
    expect(sameSheet(a, board({ sizeKind: 'custom' }))).toBe(true)
    expect(sameSheet(a, board({ sizeKind: 'custom', grain: 'short' }))).toBe(false)
    expect(sameSheet(a, board({ sizeKind: 'shihachi', width: 1220, length: 2440 }))).toBe(false)
  })
  it('小数第1位で比べる（910.04 は 910 とそろう、910.1 はそろわない）', () => {
    expect(sameSheet(board({}), board({ sizeKind: 'custom', width: 910.04 }))).toBe(true)
    expect(sameSheet(board({}), board({ sizeKind: 'custom', width: 910.1 }))).toBe(false)
  })
})

describe('stackPlan・stackLabel（どの組を重ねるか）', () => {
  it('見本でフラッシュ25 をオンにすると組が1つ（a＝メラミン 1、b＝ラワン 4）', () => {
    const job = sampleFlushJob(true)
    const plan = stackPlan(job)
    expect(plan.groups).toEqual([
      { key: stackKey(MELAMINE_1_ID, LAUAN_4_ID), boardIds: [MELAMINE_1_ID, LAUAN_4_ID], flushIds: [SAMPLE_FLUSH_ID] },
    ])
    expect(plan.mismatches).toEqual([])
    expect(stackKey(MELAMINE_1_ID, LAUAN_4_ID)).toBe(`stack:${MELAMINE_1_ID}+${LAUAN_4_ID}`)
    expect(stackLabel(job, [MELAMINE_1_ID, LAUAN_4_ID])).toBe('メラミン1＋ラワン4（重ね切り）')
  })

  it('表面材の並びを逆にしても組は同じ（材料の保存の並びで a・b を決める）', () => {
    const job = sampleFlushJob(true)
    job.flushes[0].faces.reverse()
    expect(stackPlan(job).groups.map((g) => g.boardIds)).toEqual([[MELAMINE_1_ID, LAUAN_4_ID]])
  })

  it('オフなら組は無い', () => {
    expect(stackPlan(sampleFlushJob(false))).toEqual({ groups: [], mismatches: [] })
  })

  it('ラワン 4 を 4×8 にすると組は無く、そろっていない組に1つ', () => {
    const job = sampleFlushJob(true)
    job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
    expect(stackPlan(job)).toEqual({
      groups: [],
      mismatches: [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], flushIds: [SAMPLE_FLUSH_ID] }],
    })
  })

  it('同じ2つの材料で重ねるフラッシュが2つあれば1つの組にまとめる。条件に合わない・材料が無いフラッシュは入れない', () => {
    const job = sampleFlushJob(true)
    job.flushes.push(
      { id: 'f2', name: 'フラッシュ21', core: 11, faces: [face(LAUAN_4_ID, 1), face(MELAMINE_1_ID, 1)], stack: true },
      { id: 'f3', name: 'x', core: 11, faces: [face(LAUAN_4_ID, 1), face(MELAMINE_1_ID, 2)], stack: true },
      { id: 'f4', name: 'y', core: 11, faces: [face(LAUAN_4_ID, 1), face('board-none', 1)], stack: true },
      { id: 'f5', name: 'z', core: 11, faces: [face(LAUAN_25_ID, 1), face(MELAMINE_1_ID, 1)], stack: true },
    )
    const plan = stackPlan(job)
    expect(plan.groups.map((g) => [g.boardIds, g.flushIds])).toEqual([
      [[MELAMINE_1_ID, LAUAN_25_ID], ['f5']],
      [[MELAMINE_1_ID, LAUAN_4_ID], [SAMPLE_FLUSH_ID, 'f2']],
    ])
  })

  it('材料が無いときは写しの名前を使える', () => {
    const job = sampleFlushJob(true)
    job.boards = []
    expect(
      stackLabel(job, [MELAMINE_1_ID, LAUAN_4_ID], [
        { material: 'メラミン', thickness: 1 },
        { material: 'ラワン', thickness: 4 },
      ]),
    ).toBe('メラミン1＋ラワン4（重ね切り）')
  })
})

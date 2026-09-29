// E-70（第2.6版。architecture.md 18.2・18.3）：組の行のサイズの初期値と、組の名前
import { describe, expect, it } from 'vitest'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { withStock } from '../fixtures/stock'
import type { Job } from '../types'
import { stackLabel } from './stack'
import { stackChoice } from './stock'

const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const
const S36 = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const

/** 組の行が無い見本（メラミン1・ラワン4 はどちらも 3×6） */
function noRow(): Job {
  const job = sampleGroupJob(true)
  job.stackSheets = []
  return job
}

function setSize(job: Job, boardId: string, kind: 'saburoku' | 'shihachi'): Job {
  const size = kind === 'saburoku' ? S36 : S48
  job.boards = job.boards.map((b) => (b.id === boardId ? { ...b, ...size } : b))
  return job
}

describe('stackChoice の初期値（行が無いとき。未決事項 58 の案 B）', () => {
  it('メラミン1・ラワン4 がどちらも 3×6 → 3×6', () => {
    expect(stackChoice(noRow(), PAIR)).toEqual(S36)
  })

  it('どちらも 4×8 → 4×8', () => {
    const job = setSize(setSize(noRow(), MELAMINE_1_ID, 'shihachi'), LAUAN_4_ID, 'shihachi')
    expect(stackChoice(job, PAIR)).toEqual(S48)
  })

  it('片方 3×6・片方 4×8 → 4×8', () => {
    expect(stackChoice(setSize(noRow(), LAUAN_4_ID, 'shihachi'), PAIR)).toEqual(S48)
  })

  it('片方が手持ち → 4×8', () => {
    expect(stackChoice(withStock(noRow(), LAUAN_4_ID, [['3×6', 2]]), PAIR)).toEqual(S48)
  })

  it('片方が自由入力 → 4×8', () => {
    const job = noRow()
    job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'custom', width: 910, length: 1820 } : b))
    expect(stackChoice(job, PAIR)).toEqual(S48)
  })

  it('並びを逆にしても同じ', () => {
    expect(stackChoice(noRow(), [LAUAN_4_ID, MELAMINE_1_ID])).toEqual(S36)
  })

  it('行があれば行のサイズ（材料が 3×6 でも行が 4×8 なら 4×8）', () => {
    const job = sampleGroupJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48 }]
    expect(stackChoice(job, PAIR)).toEqual(S48)
  })

  it('行が 3×6 なら材料が 4×8 でも 3×6', () => {
    const job = setSize(setSize(sampleGroupJob(true), MELAMINE_1_ID, 'shihachi'), LAUAN_4_ID, 'shihachi')
    expect(stackChoice(job, PAIR)).toEqual(S36)
  })
})

describe('stackLabel（第2.6版の名前）', () => {
  it('「2枚重ね：メラミン1＋ラワン4」', () => {
    expect(stackLabel(sampleGroupJob(true), PAIR)).toBe('2枚重ね：メラミン1＋ラワン4')
  })
})

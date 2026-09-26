import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { FLUSH_25_ID, flushJob, LAUAN_4_ID, MELAMINE_1_ID } from '../engine/fixtures/flush'
import { expandPieces } from '../engine/packing/pieces'
import type { Job } from '../engine/types'
import {
  addFlush,
  addPart,
  boardsUsages,
  flushesUsages,
  newPart,
  removeBoards,
  removeFlushes,
  setFlushCutCheck,
  updateFlush,
  updatePart,
  type OpResult,
} from './jobs'

function unwrap(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

const draft = (p: Partial<{ name: string; core: number; faces: { boardId: string; count: number }[] }> = {}) => ({
  name: 'フラッシュ30',
  core: 21,
  faces: [
    { boardId: MELAMINE_1_ID, count: 1 },
    { boardId: LAUAN_4_ID, count: 2 },
  ],
  ...p,
})

describe('フラッシュの追加・変更', () => {
  it('追加すると一覧の最後に入る（名前の前後の空白は外す）', () => {
    const job = unwrap(addFlush(flushJob(), draft({ name: ' フラッシュ30 ' }), 'flush-30'))
    expect(job.flushes.map((f) => [f.id, f.name, f.core])).toEqual([
      [FLUSH_25_ID, 'フラッシュ25', 15],
      ['flush-30', 'フラッシュ30', 21],
    ])
  })

  it('同じ名前（全角・半角の違いだけも）・空の名前は断る', () => {
    expect(addFlush(flushJob(), draft({ name: 'フラッシュ２５' })).ok).toBe(false)
    expect(addFlush(flushJob(), draft({ name: '  ' })).ok).toBe(false)
  })

  it('芯材が 0 以下、表面材が無い・無い材料・枚数が 0 や小数・同じ材料の重ねは断る', () => {
    const job = flushJob()
    expect(addFlush(job, draft({ core: 0 })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [] })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [{ boardId: 'なし', count: 1 }] })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [{ boardId: LAUAN_4_ID, count: 0 }] })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [{ boardId: LAUAN_4_ID, count: 1.5 }] })).ok).toBe(false)
    const dup = [
      { boardId: LAUAN_4_ID, count: 1 },
      { boardId: LAUAN_4_ID, count: 1 },
    ]
    expect(addFlush(job, draft({ faces: dup })).ok).toBe(false)
  })

  it('変更すると厚みがついてくる（自分と同じ名前は断らない）', () => {
    const job = unwrap(updateFlush(flushJob(), FLUSH_25_ID, draft({ name: 'フラッシュ25', core: 14 })))
    expect(job.flushes[0].core).toBe(14)
    const d = computeDimensions(job).parts[0]
    expect(d.thicknessMismatch).toBe(true) // 14＋1＋8＝23 と 25 は合わない
    expect(updateFlush(flushJob(), 'なし', draft()).ok).toBe(false)
  })
})

describe('フラッシュの削除', () => {
  it('削除の確認：選んでいる部材と、式で厚みを使っている部材', () => {
    let job = flushJob()
    job = unwrap(addPart(job, newPart({ name: '幕板', boardId: LAUAN_4_ID, expr: { W: '900', H: `{t:${FLUSH_25_ID}}`, D: '4' } })))
    expect(flushesUsages(job, [FLUSH_25_ID])).toEqual({ parts: ['天板'], thickness: ['幕板（H）'] })
  })

  it('削除すると使っていた部材は材料が未設定になり、表面材の完了も消える', () => {
    const base = unwrap(setFlushCutCheck(flushJob(), 'part-tenban', MELAMINE_1_ID, true))
    const job = unwrap(removeFlushes(base, [FLUSH_25_ID]))
    expect(job.flushes).toEqual([])
    const p = job.parts[0]
    expect(p.flushId).toBeUndefined()
    expect('flushId' in p).toBe(false)
    expect(p.boardId).toBeNull()
    expect(p.checks).toEqual({ finished: false, cut: false })
    expect(removeFlushes(flushJob(), ['なし']).ok).toBe(false)
  })
})

describe('材料の削除とフラッシュ', () => {
  it('削除の確認に、その材料を表面材に使っているフラッシュが出る', () => {
    expect(boardsUsages(flushJob(), [MELAMINE_1_ID]).flushes).toEqual(['フラッシュ25'])
  })

  it('材料を削除すると、フラッシュの表面材から外れる（厚みは 23 になる）', () => {
    const job = unwrap(removeBoards(flushJob(), [MELAMINE_1_ID]))
    expect(job.flushes[0].faces).toEqual([{ boardId: LAUAN_4_ID, count: 2 }])
  })
})

describe('部材の材料とフラッシュ', () => {
  it('フラッシュを選んだ部材は boardId が null にそろう', () => {
    const job = unwrap(addPart(flushJob(), newPart({ name: '地板', boardId: LAUAN_4_ID, flushId: FLUSH_25_ID })))
    expect(job.parts[1].boardId).toBeNull()
    expect(job.parts[1].flushId).toBe(FLUSH_25_ID)
  })

  it('材料に戻すときは flushId: undefined を渡す（キーごと消える）', () => {
    const job = unwrap(updatePart(flushJob(), 'part-tenban', { flushId: undefined, boardId: LAUAN_4_ID }))
    expect('flushId' in job.parts[0]).toBe(false)
    expect(job.parts[0].boardId).toBe(LAUAN_4_ID)
  })

  it('無いフラッシュは断る', () => {
    expect(updatePart(flushJob(), 'part-tenban', { flushId: 'なし' }).ok).toBe(false)
  })
})

describe('setFlushCutCheck（部材×表面材の完了）', () => {
  it('メラミン1 を完了にすると木取りから メラミン1 だけ除かれる。外すと戻る', () => {
    const job = unwrap(setFlushCutCheck(flushJob(), 'part-tenban', MELAMINE_1_ID, true))
    expect(job.parts[0].checks.cutByBoard).toEqual({ [MELAMINE_1_ID]: true })
    const r = expandPieces(job, computeDimensions(job))
    expect(r.groups.map((g) => [g.board.id, g.pieces.length])).toEqual([[LAUAN_4_ID, 4]])
    const back = unwrap(setFlushCutCheck(job, 'part-tenban', MELAMINE_1_ID, false))
    expect(back.parts[0].checks.cutByBoard).toEqual({})
  })

  it('フラッシュでない部材・表面材でない材料は断る', () => {
    expect(setFlushCutCheck(flushJob(), 'なし', MELAMINE_1_ID, true).ok).toBe(false)
    expect(setFlushCutCheck(flushJob(), 'part-tenban', 'なし', true).ok).toBe(false)
  })
})

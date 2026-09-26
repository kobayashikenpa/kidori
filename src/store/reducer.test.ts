import { describe, expect, it } from 'vitest'
import { bookshelfJob } from '../engine/fixtures/bookshelf'
import { createJob, updatePart, updateSettings } from './jobs'
import { currentJob, initialState, storeReducer, type StoreState } from './reducer'

const NOW = new Date('2026-09-24T10:00:00.000Z')

/** 見本（本棚 W900）を1つ開いた状態 */
function stateWithSample(): StoreState {
  const t = NOW.toISOString()
  const sample = { ...bookshelfJob(), createdAt: t, updatedAt: t }
  return initialState({ status: 'ok', data: { jobs: [sample], currentJobId: sample.id } })
}

describe('initialState', () => {
  it('読めたが知らせがあるとき（移し替えで寸法が変わった部材）は、知らせを出して保存は続ける', () => {
    const s = initialState({ status: 'ok', data: { jobs: [], currentJobId: null }, message: '以前の版から移したときに寸法が変わった部材：本棚の A' })
    expect(s.loadError).toBe('以前の版から移したときに寸法が変わった部材：本棚の A')
    expect(s.canSave).toBe(true)
  })

  it('何も保存されていなければ、仕事が1つもない空の状態で始める（見本は自動で開かない）', () => {
    const s = initialState({ status: 'empty', data: { jobs: [], currentJobId: null } })
    expect(s.jobs).toEqual([])
    expect(s.currentJobId).toBeNull()
    expect(currentJob(s)).toBeNull()
    expect(s.loadError).toBeNull()
    expect(s.canSave).toBe(true)
  })

  it('読めなかったときは空の一覧で、知らせを持つ', () => {
    const s = initialState({
      status: 'error',
      data: { jobs: [], currentJobId: null },
      message: '保存データを読めませんでした',
      canSave: false,
    })
    expect(s.jobs).toEqual([])
    expect(s.loadError).toBe('保存データを読めませんでした')
    expect(s.canSave).toBe(false)
  })

  it('読めたときはその内容で始める', () => {
    const job = bookshelfJob()
    const s = initialState({ status: 'ok', data: { jobs: [job], currentJobId: null } })
    expect(s.jobs).toEqual([job])
    expect(currentJob(s)).toBeNull()
  })
})

describe('storeReducer', () => {
  it('操作を当てると仕事が変わり、更新日時が進む', () => {
    const s0 = stateWithSample()
    const id = s0.currentJobId!
    const s1 = storeReducer(s0, {
      type: 'applyOp',
      jobId: id,
      op: (j) => updatePart(j, 'part-zentai', { expr: { W: '1000', H: '1800', D: '400' } }),
      now: '2026-09-24T11:00:00.000Z',
    })
    expect(currentJob(s1)?.parts[0].expr.W).toBe('1000')
    expect(currentJob(s1)?.updatedAt).toBe('2026-09-24T11:00:00.000Z')
    expect(currentJob(s0)?.parts[0].expr.W).toBe('900')
  })

  it('失敗する操作は何も変えない', () => {
    const s0 = stateWithSample()
    const s1 = storeReducer(s0, {
      type: 'applyOp',
      jobId: s0.currentJobId!,
      op: (j) => updateSettings(j, { kerf: -1 }),
      now: 'x',
    })
    expect(s1).toBe(s0)
  })

  it('仕事を足して開く・開き直す', () => {
    const s0 = stateWithSample()
    const job = createJob('食器棚')
    const s1 = storeReducer(s0, { type: 'addJob', job, open: true })
    expect(s1.jobs).toHaveLength(2)
    expect(currentJob(s1)?.name).toBe('食器棚')
    const s2 = storeReducer(s1, { type: 'openJob', id: s0.currentJobId })
    expect(currentJob(s2)?.name).toBe('本棚 W900')
  })

  it('無い仕事は開かない', () => {
    const s0 = stateWithSample()
    expect(storeReducer(s0, { type: 'openJob', id: 'nothing' })).toBe(s0)
  })
})

describe('removeJob', () => {
  it('開いていた仕事を消すと、何も開いていない状態になる', () => {
    const s0 = stateWithSample()
    const other = createJob('食器棚', NOW, 'job-other')
    const s1 = storeReducer(s0, { type: 'addJob', job: other, open: false })
    const s2 = storeReducer(s1, { type: 'removeJob', id: s0.currentJobId! })
    expect(s2.jobs.map((j) => j.id)).toEqual(['job-other'])
    expect(s2.currentJobId).toBeNull()
  })

  it('開いていない仕事を消しても、開いている仕事はそのまま', () => {
    const s0 = stateWithSample()
    const other = createJob('食器棚', NOW, 'job-other')
    const s1 = storeReducer(s0, { type: 'addJob', job: other, open: false })
    const s2 = storeReducer(s1, { type: 'removeJob', id: 'job-other' })
    expect(s2.currentJobId).toBe(s0.currentJobId)
    expect(s2.jobs).toHaveLength(1)
  })
})

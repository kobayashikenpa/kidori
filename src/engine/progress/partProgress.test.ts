// E-82 部材ごとの進み具合（第2.7版。architecture.md 19.7）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { CORE_15_ID, LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { packJob } from '../packing'
import { stackKey } from '../packing/stack'
import type { Job } from '../types'
import { freezeSheet } from './frozen'
import { partCutProgress } from './partProgress'

const NOW = new Date('2026-09-30T09:00:00.000Z')
const rows = (job: Job) => partCutProgress(job).map((r) => [r.name, r.done, r.total])

/** 材料 key の i 枚目を固定して、その部材の片を n 個（先頭から）チェックする */
function freezeWith(job: Job, key: string, i: number, partId: string, n: number, board = key, stackWith?: string): Job {
  const m = packJob(job, computeDimensions(job)).materials.find((x) => x.boardId === key)!
  const f = freezeSheet(job, board, m.mode, m.sheets[i], `sheet-${job.frozenSheets.length + 1}`, NOW, stackWith)
  f.checked = f.layout.placements.filter((p) => p.partId === partId).slice(0, n).map((p) => p.pieceId)
  if (f.checked.length === f.layout.placements.length) f.completedAt = NOW.toISOString()
  return { ...job, frozenSheets: [...job.frozenSheets, f] }
}

describe('partCutProgress（E-82）', () => {
  it('本棚の見本で何もチェックしていない：部材の順・全体（枚数0）は入らない', () => {
    expect(rows(bookshelfJob())).toEqual([
      ['側板', 0, 2],
      ['天地板', 0, 2],
      ['棚板', 0, 4],
      ['背板', 0, 1],
    ])
    expect(partCutProgress(bookshelfJob())[0].partId).toBe('part-gawaita')
  })

  it('3枚目の棚板の片2つ → 2/4。続けて2枚目の棚板の片2つ → 4/4（どの1枚から切っても）', () => {
    let job = bookshelfJob()
    job = freezeWith(job, LUMBER_18_ID, 2, 'part-tanaita', 2)
    expect(rows(job)[2]).toEqual(['棚板', 2, 4])
    job = freezeWith(job, LUMBER_18_ID, 1, 'part-tanaita', 2)
    expect(rows(job)[2]).toEqual(['棚板', 4, 4])
    expect(rows(job)[1]).toEqual(['天地板', 0, 2])
  })

  it('片の1つだけにチェック → 1', () => {
    const job = freezeWith(bookshelfJob(), LUMBER_18_ID, 1, 'part-tenchiita', 1)
    expect(rows(job)[1]).toEqual(['天地板', 1, 2])
  })

  it('固定したあと部材の枚数を減らしても done は total を超えない', () => {
    let job = freezeWith(bookshelfJob(), LUMBER_18_ID, 0, 'part-gawaita', 2)
    job = { ...job, parts: job.parts.map((p) => (p.id === 'part-gawaita' ? { ...p, quantity: 1 } : p)) }
    expect(rows(job)[0]).toEqual(['側板', 1, 1])
  })

  it('以前の checks.cut の部材は done＝total', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) => (p.id === 'part-tanaita' ? { ...p, checks: { ...p.checks, cut: true } } : p))
    expect(rows(job)[2]).toEqual(['棚板', 4, 4])
  })

  it('フラッシュ25（メラミン1×2・ラワン4×2）の側板 2枚 → 0/8。木取りしない芯材は数えない', () => {
    expect(rows(sampleGroupJob(false))).toEqual([
      ['側板', 0, 8],
      ['天地板', 0, 8],
      ['棚板', 0, 16],
      ['背板', 0, 1],
    ])
  })

  it('以前の cutByBoard（メラミン1 だけ）→ 側板 4/8', () => {
    const job = sampleGroupJob(false)
    job.parts = job.parts.map((p) => (p.id === 'part-gawa' ? { ...p, checks: { ...p.checks, cutByBoard: { [MELAMINE_1_ID]: true } } } : p))
    expect(rows(job)[0]).toEqual(['側板', 4, 8])
  })

  it('重ねた板で側板の片2つにチェック → 4/8（1片を上下2と数える）', () => {
    const job = freezeWith(sampleGroupJob(true), stackKey(MELAMINE_1_ID, LAUAN_4_ID), 0, 'part-gawa', 2, MELAMINE_1_ID, LAUAN_4_ID)
    expect(job.frozenSheets[0].checked).toHaveLength(2)
    expect(rows(job)[0]).toEqual(['側板', 4, 8])
  })

  it('材料が無い・木取りしない材料だけ・枚数0 の部材は入れない', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) =>
      p.id === 'part-gawaita' ? { ...p, boardId: null } : p.id === 'part-tenchiita' ? { ...p, quantity: 0 } : p,
    )
    job.boards = [...job.boards, { id: CORE_15_ID, material: '芯材', thickness: 15, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', noCut: true }]
    job.parts = job.parts.map((p) => (p.id === 'part-seita' ? { ...p, boardId: CORE_15_ID } : p))
    expect(rows(job)).toEqual([['棚板', 0, 4]])
  })
})

import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import { packJob } from '../packing'
import type { Job } from '../types'
import { freezeSheet, frozenDemand } from './frozen'

const NOW = new Date('2026-09-27T09:00:00.000Z')

function firstSheet(job: Job, boardId: string) {
  const m = packJob(job, computeDimensions(job)).materials.find((x) => x.boardId === boardId)!
  return { mode: m.mode, layout: m.sheets[0] }
}

describe('freezeSheet（固定した1枚の写しを作る）', () => {
  it('材料名・厚み・木目・切り方・刃厚・端切りを写し、チェックは空', () => {
    const job = bookshelfJob()
    job.settings = { ...job.settings, kerf: 4, trim: 6 }
    const { mode, layout } = firstSheet(job, LUMBER_18_ID)
    const f = freezeSheet(job, LUMBER_18_ID, mode, layout, 'sheet-1', NOW)
    expect(f).toMatchObject({
      id: 'sheet-1',
      boardId: LUMBER_18_ID,
      material: 'シナランバー',
      thickness: 18,
      grain: 'long',
      mode: 'vertical',
      kerf: 4,
      trim: 6,
      checked: [],
      frozenAt: NOW.toISOString(),
    })
    expect(f.completedAt).toBeUndefined()
    expect(f.layout).toEqual(layout)
  })

  it('深いコピー：元の layout を書き換えても写しは変わらない（写しを書き換えても元は変わらない）', () => {
    const job = bookshelfJob()
    const { mode, layout } = firstSheet(job, LUMBER_18_ID)
    const before = JSON.parse(JSON.stringify(layout))
    const f = freezeSheet(job, LUMBER_18_ID, mode, layout, 's', NOW)
    layout.placements[0].x = 999
    layout.placements[0].name = '書き換え'
    layout.cuts[0].within.w = 1
    layout.usable.w = 1
    layout.placements.push({ ...layout.placements[0] })
    expect(f.layout).toEqual(before)
    f.layout.placements[1].y = 0
    f.layout.scraps.length = 0
    expect(firstSheet(bookshelfJob(), LUMBER_18_ID).layout).toEqual(before)
  })

  it('おまかせで横切り優先が選ばれたら、写しの切り方は horizontal', () => {
    const job = bookshelfJob()
    const { layout } = firstSheet(job, VENEER_4_ID)
    job.settings = { ...job.settings, cutMode: 'auto' }
    expect(freezeSheet(job, VENEER_4_ID, 'horizontal', layout, 's', NOW).mode).toBe('horizontal')
  })

  it('材料が無ければ例外', () => {
    const job = bookshelfJob()
    const { mode, layout } = firstSheet(job, LUMBER_18_ID)
    expect(() => freezeSheet(job, 'board-none', mode, layout, 's', NOW)).toThrow()
  })
})

describe('frozenDemand（固定した片の数。部材|材料 ごと）', () => {
  it('固定した1枚が無ければ空', () => {
    expect(frozenDemand(bookshelfJob()).size).toBe(0)
  })

  it('切り終わりの1枚も含めて、片の数を部材×材料ごとに数える', () => {
    const job = bookshelfJob()
    const dims = computeDimensions(job)
    const m = packJob(job, dims).materials.find((x) => x.boardId === LUMBER_18_ID)!
    // 1枚目 側板×2、2枚目 天地板×2＋棚板×2
    const a = freezeSheet(job, LUMBER_18_ID, m.mode, m.sheets[0], 'a', NOW)
    const b = { ...freezeSheet(job, LUMBER_18_ID, m.mode, m.sheets[1], 'b', NOW), completedAt: NOW.toISOString() }
    const d = frozenDemand({ frozenSheets: [a, b] })
    expect(d.get(`part-gawaita|${LUMBER_18_ID}`)).toBe(2)
    expect(d.get(`part-tenchiita|${LUMBER_18_ID}`)).toBe(2)
    expect(d.get(`part-tanaita|${LUMBER_18_ID}`)).toBe(2)
    expect(d.get(`part-seita|${VENEER_4_ID}`)).toBeUndefined()
  })
})

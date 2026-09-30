// S-35 1枚の中の同じ部材をまとめて付け外しする（第2.7版。architecture.md 19.6）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../engine/fixtures/bookshelf'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../engine/fixtures/flush'
import { packJob } from '../engine/packing'
import { stackKey } from '../engine/packing/stack'
import { frozenDemand } from '../engine/progress/frozen'
import type { Job } from '../engine/types'
import { setPartCheck, type OpResult, type SheetTarget } from './jobs'

const NOW = new Date('2026-09-30T09:00:00.000Z')
const LATER = new Date('2026-09-30T10:00:00.000Z')

function computed(job: Job, i: number): SheetTarget {
  const m = packJob(job, computeDimensions(job)).materials.find((x) => x.boardId === LUMBER_18_ID)!
  return { kind: 'computed', boardId: LUMBER_18_ID, mode: m.mode, layout: m.sheets[i] }
}
function okJob(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const FROZEN: SheetTarget = { kind: 'frozen', sheetId: 'sheet-1' }

describe('setPartCheck（S-35）', () => {
  it('本棚の見本の2枚目：天地板 → 棚板 → 棚板を外す → 天地板を外す', () => {
    const job0 = bookshelfJob()
    const layout = (computed(job0, 1) as Extract<SheetTarget, { kind: 'computed' }>).layout
    const tenchi = layout.placements.filter((p) => p.partId === 'part-tenchiita').map((p) => p.pieceId)
    const tana = layout.placements.filter((p) => p.partId === 'part-tanaita').map((p) => p.pieceId)

    const j1 = okJob(setPartCheck(job0, computed(job0, 1), 'part-tenchiita', true, NOW, 'sheet-1'))
    expect(j1.frozenSheets).toHaveLength(1)
    expect(j1.frozenSheets[0].id).toBe('sheet-1')
    expect([...j1.frozenSheets[0].checked].sort()).toEqual([...tenchi].sort())
    expect(j1.frozenSheets[0].completedAt).toBeUndefined()

    const j2 = okJob(setPartCheck(j1, FROZEN, 'part-tanaita', true, LATER))
    expect(j2.frozenSheets[0].checked).toHaveLength(4)
    expect(j2.frozenSheets[0].checked).toEqual(expect.arrayContaining(tana))
    expect(j2.frozenSheets[0].completedAt).toBe(LATER.toISOString())

    const j3 = okJob(setPartCheck(j2, FROZEN, 'part-tanaita', false))
    expect(j3.frozenSheets[0].completedAt).toBeUndefined()
    expect([...j3.frozenSheets[0].checked].sort()).toEqual([...tenchi].sort())

    const j4 = okJob(setPartCheck(j3, FROZEN, 'part-tenchiita', false))
    expect(j4.frozenSheets).toEqual([])
  })

  it('1枚目で側板を付ける → 固定して、そのまま切り終わり', () => {
    const job = bookshelfJob()
    const j = okJob(setPartCheck(job, computed(job, 0), 'part-gawaita', true, NOW, 'sheet-1'))
    expect(j.frozenSheets).toHaveLength(1)
    expect(j.frozenSheets[0].checked).toHaveLength(2)
    expect(j.frozenSheets[0].completedAt).toBe(NOW.toISOString())
  })

  it('一部だけ付いている固定した1枚（以前のデータ）：付けると残りだけ足す', () => {
    const job = bookshelfJob()
    const j1 = okJob(setPartCheck(job, computed(job, 1), 'part-tenchiita', true, NOW, 'sheet-1'))
    const tana = j1.frozenSheets[0].layout.placements.filter((p) => p.partId === 'part-tanaita').map((p) => p.pieceId)
    const partial: Job = { ...j1, frozenSheets: [{ ...j1.frozenSheets[0], checked: [...j1.frozenSheets[0].checked, tana[0]] }] }
    const j2 = okJob(setPartCheck(partial, FROZEN, 'part-tanaita', true, LATER))
    expect(j2.frozenSheets[0].checked).toHaveLength(4)
    expect(new Set(j2.frozenSheets[0].checked).size).toBe(4)
    expect(j2.frozenSheets[0].completedAt).toBe(LATER.toISOString())
  })

  it('重ねた板で付けると frozenDemand が上下の材料の両方で片の数ずつ増える', () => {
    const job = sampleGroupJob(true)
    const m = packJob(job, computeDimensions(job)).materials.find((x) => x.boardId === stackKey(MELAMINE_1_ID, LAUAN_4_ID))!
    const layout = m.sheets[0]
    const n = layout.placements.filter((p) => p.partId === 'part-gawa').length
    const target: SheetTarget = { kind: 'computed', boardId: MELAMINE_1_ID, stackWith: LAUAN_4_ID, mode: m.mode, layout }
    const j = okJob(setPartCheck(job, target, 'part-gawa', true, NOW, 'sheet-1'))
    expect(j.frozenSheets[0].stackWith?.boardId).toBe(LAUAN_4_ID)
    expect(j.frozenSheets[0].checked).toHaveLength(n)
    const d = frozenDemand(j)
    expect(d.get(`part-gawa|${MELAMINE_1_ID}`)).toBe(n)
    expect(d.get(`part-gawa|${LAUAN_4_ID}`)).toBe(n)
  })

  it('その1枚に無い部材・無い部材の id は断る。元の job は変わらない', () => {
    const job = bookshelfJob()
    const r1 = setPartCheck(job, computed(job, 0), 'part-none', true, NOW, 'sheet-1')
    expect(r1).toEqual({ ok: false, message: '部材が見つかりません' })
    const r2 = setPartCheck(job, computed(job, 0), 'part-tanaita', true, NOW, 'sheet-1')
    expect(r2.ok).toBe(false)
    const j1 = okJob(setPartCheck(job, computed(job, 0), 'part-gawaita', true, NOW, 'sheet-1'))
    expect(setPartCheck(j1, FROZEN, 'part-seita', false).ok).toBe(false)
    expect(setPartCheck(j1, { kind: 'frozen', sheetId: 'sheet-x' }, 'part-gawaita', true).ok).toBe(false)
    expect(job.frozenSheets).toEqual([])
  })

  it('計算した1枚で「外す」は何も変えない', () => {
    const job = bookshelfJob()
    const r = okJob(setPartCheck(job, computed(job, 1), 'part-tanaita', false, NOW, 'sheet-1'))
    expect(r).toBe(job)
  })

  it('全部付いている部材を付ける／付いていない部材を外すは何も変えない', () => {
    const job = bookshelfJob()
    const j1 = okJob(setPartCheck(job, computed(job, 1), 'part-tenchiita', true, NOW, 'sheet-1'))
    expect(okJob(setPartCheck(j1, FROZEN, 'part-tenchiita', true, LATER))).toEqual(j1)
    expect(okJob(setPartCheck(j1, FROZEN, 'part-tanaita', false))).toEqual(j1)
  })
})

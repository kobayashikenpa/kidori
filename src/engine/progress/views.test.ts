import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import { flushJob, LAUAN_4_ID, MELAMINE_1_ID } from '../fixtures/flush'
import { packJob } from '../packing'
import type { Job } from '../types'
import { freezeSheet, frozenSheetViews, materialSummaries } from './frozen'

const NOW = new Date('2026-09-27T09:00:00.000Z')

function freeze(job: Job, boardId: string, i: number, checks = 1): Job {
  const m = packJob(job, computeDimensions(job)).materials.find((x) => x.boardId === boardId)!
  const f = freezeSheet(job, boardId, m.mode, m.sheets[i], `sheet-${job.frozenSheets.length + 1}`, NOW)
  f.checked = f.layout.placements.slice(0, checks).map((p) => p.pieceId)
  if (f.checked.length === f.layout.placements.length) f.completedAt = NOW.toISOString()
  return { ...job, frozenSheets: [...job.frozenSheets, f] }
}
const views = (job: Job) => frozenSheetViews(job, computeDimensions(job))
const setPart = (job: Job, name: string, patch: object): Job => ({
  ...job,
  parts: job.parts.map((p) => (p.name === name ? { ...p, ...patch } : p)),
})
const setExpr = (job: Job, name: string, axis: 'W' | 'H' | 'D', v: string): Job => {
  const p = job.parts.find((x) => x.name === name)!
  return setPart(job, name, { expr: { ...p.expr, [axis]: v } })
}

describe('frozenSheetViews（表示用のまとめ・部材が変わっています）', () => {
  const base = freeze(bookshelfJob(), VENEER_4_ID, 0)

  it('変わっていなければ drift は空。名前・材料・進み具合・切り終わりでない', () => {
    const [v] = views(base)
    expect(v.label).toBe('シナベニヤ 4mm')
    expect(v.boardExists).toBe(true)
    expect(v.drift).toEqual([])
    expect(v.complete).toBe(true) // 背板1枚だけの1枚で、1つチェック
    expect(v.progress.nextStep).toBeNull()
    const [w] = views(freeze(bookshelfJob(), LUMBER_18_ID, 0))
    expect(w.complete).toBe(false)
    expect(w.progress.doneSteps).toEqual([1, 2, 3])
  })

  it('全体.W を 880 にすると 背板（size）。写しの配置は変わらない', () => {
    const job = setExpr(base, '全体', 'W', '880')
    const [v] = views(job)
    expect(v.drift).toEqual([{ partId: 'part-seita', name: '背板', reason: 'size' }])
    expect(v.sheet.layout).toEqual(base.frozenSheets[0].layout)
  })

  it('寸法のエラーで今の寸法が出ないときも size', () => {
    expect(views(setExpr(base, '背板', 'W', '(')).map((v) => v.drift)).toEqual([
      [{ partId: 'part-seita', name: '背板', reason: 'size' }],
    ])
  })

  it('背板の枚数を 0 にすると count、消すと removed、材料を変えると removed', () => {
    expect(views(setPart(base, '背板', { quantity: 0 }))[0].drift).toEqual([{ partId: 'part-seita', name: '背板', reason: 'count' }])
    const removed = { ...base, parts: base.parts.filter((p) => p.name !== '背板') }
    expect(views(removed)[0].drift).toEqual([{ partId: 'part-seita', name: '背板', reason: 'removed' }])
    expect(views(setPart(base, '背板', { boardId: LUMBER_18_ID }))[0].drift[0].reason).toBe('removed')
  })

  it('部材名を変えると drift の名前も今の名前（変わったとは知らせない）', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    const renamed = setPart(job, '側板', { name: '側板L' })
    expect(views(renamed)[0].drift).toEqual([])
    // 側板は 全体.H を参照するので、名前だけ変えても寸法は同じ
    expect(views(setPart(renamed, '側板L', { quantity: 1 }))[0].drift).toEqual([
      { partId: 'part-gawaita', name: '側板L', reason: 'count' },
    ])
  })

  it('枚数を増やしても、木目・切り代を変えても（寸法が同じなら）知らせない', () => {
    let job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    job = setPart(job, '側板', { quantity: 5, grain: 'any' })
    expect(views(job)[0].drift).toEqual([])
  })

  it('count は、すべての固定した1枚（切り終わりを含む）の片の数と比べる', () => {
    let job = freeze(bookshelfJob(), LUMBER_18_ID, 1, 4) // 2枚目（天地板×2＋棚板×2）を切り終わり
    job = freeze(job, LUMBER_18_ID, 1) // 次の計算の2枚目（残りは 側板×2 と 棚板×2 の2枚）
    expect(views(job).map((v) => v.drift)).toEqual([[], []])
    job = setPart(job, '棚板', { quantity: 3 })
    expect(views(job).map((v) => v.drift.map((d) => `${d.name}:${d.reason}`))).toEqual([['棚板:count'], ['棚板:count']])
  })

  it('材料を削除しても写しの名前で出し、boardExists は false・部材は removed', () => {
    const job = { ...base, boards: base.boards.filter((b) => b.id !== VENEER_4_ID) }
    const job2 = { ...job, parts: job.parts.map((p) => (p.boardId === VENEER_4_ID ? { ...p, boardId: null } : p)) }
    const [v] = views(job2)
    expect(v.label).toBe('シナベニヤ 4mm')
    expect(v.boardExists).toBe(false)
    expect(v.drift.map((d) => d.reason)).toEqual(['removed'])
  })

  it('フラッシュ：表面材から外すと removed、表面材の枚数を減らすと count', () => {
    const job = freeze(flushJob(), MELAMINE_1_ID, 0)
    expect(views(job)[0].drift).toEqual([])
    const faces = (f: Job['flushes'][number]['faces']) => ({ ...job, flushes: job.flushes.map((x) => ({ ...x, faces: f })) })
    expect(views(faces([{ boardId: LAUAN_4_ID, count: 2 }]))[0].drift.map((d) => d.reason)).toEqual(['removed'])
    // 1枚に天板は1枚。3枚固定して部材の枚数を 1 にすると、表面材2枚 × 1 ＝ 2 ＜ 3 で count。2 なら 4 ≧ 3 で知らせない
    let three = job
    for (let i = 0; i < 2; i++) three = freeze(three, MELAMINE_1_ID, 0)
    expect(views(three).map((v) => v.drift)).toEqual([[], [], []])
    expect(views(setPart(three, '天板', { quantity: 1 }))[0].drift).toEqual([{ partId: 'part-tenban', name: '天板', reason: 'count' }])
  })
})

describe('materialSummaries（画面の枚数・歩留まり）', () => {
  it('固定が無ければ packJob と同じ', () => {
    const job = bookshelfJob()
    const r = packJob(job, computeDimensions(job))
    const s = materialSummaries(job, r, views(job))
    expect(s.materials).toEqual(r.materials.map((m) => ({ boardId: m.boardId, sheetCount: m.sheetCount, offcutCount: 0, stackedCount: 0, yieldRate: m.yieldRate, completedCount: 0 })))
    expect(s.totalYieldRate).toBeCloseTo(r.totalYieldRate, 10)
  })

  it('固定した1枚（チェック1つ）は枚数に入り、切り終わりは入らない。歩留まりも同じ1枚たちで出す', () => {
    const job0 = bookshelfJob()
    const r0 = packJob(job0, computeDimensions(job0))
    const job = freeze(job0, LUMBER_18_ID, 0)
    const r = packJob(job, computeDimensions(job))
    const s = materialSummaries(job, r, views(job))
    expect(s.materials[0]).toMatchObject({ boardId: LUMBER_18_ID, sheetCount: 3, completedCount: 0 })
    expect(s.materials[0].yieldRate).toBeCloseTo(r0.materials[0].yieldRate, 10)
    const done = freeze(job0, LUMBER_18_ID, 0, 2)
    const s2 = materialSummaries(done, packJob(done, computeDimensions(done)), views(done))
    expect(s2.materials[0]).toMatchObject({ sheetCount: 2, completedCount: 1 })
  })

  it('固定した1枚しか無い材料・切り終わりしか無い材料・削除した材料も入る（削除した材料は最後）', () => {
    let job = freeze(bookshelfJob(), VENEER_4_ID, 0) // 背板1枚 → 切り終わり
    let s = materialSummaries(job, packJob(job, computeDimensions(job)), views(job))
    expect(s.materials.map((m) => [m.boardId, m.sheetCount, m.completedCount])).toEqual([
      [LUMBER_18_ID, 3, 0],
      [VENEER_4_ID, 0, 1],
    ])
    job = { ...job, boards: job.boards.filter((b) => b.id !== VENEER_4_ID), parts: job.parts.filter((p) => p.name !== '背板') }
    job = freeze(job, LUMBER_18_ID, 0)
    job = { ...job, frozenSheets: [job.frozenSheets[1], job.frozenSheets[0]] }
    s = materialSummaries(job, packJob(job, computeDimensions(job)), views(job))
    expect(s.materials.map((m) => [m.boardId, m.sheetCount, m.completedCount])).toEqual([
      [LUMBER_18_ID, 3, 0],
      [VENEER_4_ID, 0, 1],
    ])
  })
})

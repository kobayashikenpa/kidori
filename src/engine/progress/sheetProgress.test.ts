import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { packJob } from '../packing'
import type { Job, Rect, SheetLayout } from '../types'
import { sheetProgress } from './sheetProgress'

type Mode = Job['settings']['cutMode']

function sheets(mode: Mode, patch: Partial<Job['settings']> = {}, edit?: (job: Job) => void): SheetLayout[] {
  const job = bookshelfJob()
  job.settings = { ...job.settings, cutMode: mode, ...patch }
  edit?.(job)
  return packJob(job, computeDimensions(job)).materials.find((m) => m.boardId === LUMBER_18_ID)!.sheets
}
const rectOf = (r: Rect) => ({ x: r.x, y: r.y, w: r.w, h: r.h })
const idAt = (s: SheetLayout, pred: (r: Rect) => boolean) => s.placements.find(pred)!.pieceId
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - 0.05 && b.x < a.x + a.w - 0.05 && a.y < b.y + b.h - 0.05 && b.y < a.y + a.h - 0.05
const inside = (o: Rect, i: Rect) =>
  i.x >= o.x - 0.05 && i.y >= o.y - 0.05 && i.x + i.w <= o.x + o.w + 0.05 && i.y + i.h <= o.y + o.h + 0.05

describe('sheetProgress 縦切り優先（見本の1枚目：3×6・端切り5・刃厚3・側板 410×1810 ×2）', () => {
  const [first] = sheets('vertical')
  const right = idAt(first, (r) => r.x > 400)
  const left = idAt(first, (r) => r.x < 400)

  it('配置と切る順番の前提（右の側板 x 495〜905、左 x 82〜492、工程 5つ）', () => {
    expect(first.placements.map(rectOf)).toEqual([
      { x: 495, y: 10, w: 410, h: 1810 },
      { x: 82, y: 10, w: 410, h: 1810 },
    ])
    expect(first.cuts.map((c) => [c.no, c.kind, c.at])).toEqual([
      [1, 'trim', 905],
      [2, 'strip', 495],
      [3, 'crosscut', 10],
      [4, 'strip', 82],
      [5, 'crosscut', 10],
    ])
  })

  it('チェックなし：済んだ工程なし・次は 1・残りは板全体（部材がすべて入っている）', () => {
    const p = sheetProgress(first, 3, [])
    expect(p.doneSteps).toEqual([])
    expect(p.nextStep).toBe(1)
    expect(p.remaining).toEqual([{ rect: { x: 0, y: 0, w: 910, h: 1820 }, pieceIds: [right, left] }])
  })

  it('右の側板だけ：済んだ工程 1・2・3、次は 4、残りは x 0〜492 の 492×1820（410×7 は 30mm 未満で出さない）', () => {
    const p = sheetProgress(first, 3, [right])
    expect(p.doneSteps).toEqual([1, 2, 3])
    expect(p.nextStep).toBe(4)
    expect(p.remaining).toEqual([{ rect: { x: 0, y: 0, w: 492, h: 1820 }, pieceIds: [left] }])
  })

  it('左の側板だけ：左の帯を取り出すのに右の帯の切り離し（2）も要る。済んだ工程 1・2・4・5、次は 3', () => {
    const p = sheetProgress(first, 3, [left])
    expect(p.doneSteps).toEqual([1, 2, 4, 5])
    expect(p.nextStep).toBe(3)
    expect(p.remaining).toEqual([
      { rect: { x: 495, y: 0, w: 410, h: 1820 }, pieceIds: [right] },
      { rect: { x: 0, y: 0, w: 79, h: 1820 }, pieceIds: [] },
    ])
  })

  it('両方：済んだ工程 1〜5、次は無し、残りは端材 79×1820 だけ（チェックの順番は問わない）', () => {
    for (const checked of [[right, left], [left, right]]) {
      const p = sheetProgress(first, 3, checked)
      expect(p.doneSteps).toEqual([1, 2, 3, 4, 5])
      expect(p.nextStep).toBeNull()
      expect(p.remaining).toEqual([{ rect: { x: 0, y: 0, w: 79, h: 1820 }, pieceIds: [] }])
    }
  })

  it('写しに無い pieceId は無視する', () => {
    expect(sheetProgress(first, 3, ['none#1']).doneSteps).toEqual([])
  })

  it('刃厚は余りの側で引く：刃厚4 で並べた1枚を刃厚4 で分けると、左は 0〜491', () => {
    const [s] = sheets('vertical', { kerf: 4 })
    const r = idAt(s, (x) => x.x > 400)
    expect(sheetProgress(s, 4, [r]).remaining[0].rect).toEqual({ x: 0, y: 0, w: 491, h: 1820 })
  })

  it('端切り0：端切りの工程が無く、残りは板の右端まで使った左側', () => {
    const [s] = sheets('vertical', { trim: 0 })
    expect(s.cuts[0].kind).not.toBe('trim')
    const r = idAt(s, (x) => x.x > 400)
    const p = sheetProgress(s, 3, [r])
    expect(p.doneSteps).toEqual([1, 2])
    expect(p.remaining[0]).toEqual({ rect: { x: 0, y: 0, w: 497, h: 1820 }, pieceIds: [idAt(s, (x) => x.x < 400)] })
  })
})

describe('sheetProgress 縦切り優先の2枚目（天地板×2＋棚板×2。細い棚板は次の帯）', () => {
  const [, second] = sheets('vertical')

  it('帯の中の一番上の片：帯の切り離しと、帯の切り分け1つ', () => {
    const top = second.placements[0]
    const p = sheetProgress(second, 3, [top.pieceId])
    const needed = second.cuts.filter((c) => inside(c.within, top)).map((c) => c.no)
    expect(p.doneSteps).toEqual(needed)
    expect(p.remaining.flatMap((r) => r.pieceIds).sort()).toEqual(second.placements.slice(1).map((x) => x.pieceId).sort())
  })
})

describe('sheetProgress 横切り優先の1枚目（横長・側板 1810×410 ×2）', () => {
  const [first] = sheets('horizontal')
  const top = idAt(first, (r) => r.y > 400)
  const bottom = idAt(first, (r) => r.y < 400)

  it('前提：端切り 上の長手（1）・右の妻手（2）、帯の切り離し（3）、切り分け（4・5）', () => {
    expect(first.cuts.map((c) => [c.no, c.kind, c.direction, c.at])).toEqual([
      [1, 'trim', 'horizontal', 905],
      [2, 'trim', 'vertical', 1815],
      [3, 'strip', 'vertical', 5],
      [4, 'crosscut', 'horizontal', 495],
      [5, 'crosscut', 'horizontal', 82],
    ])
  })

  it('上の側板：済んだ工程 1〜4、次は 5。残りは下の 1810×492（左の 2mm は捨てる）', () => {
    const p = sheetProgress(first, 3, [top])
    expect(p.doneSteps).toEqual([1, 2, 3, 4])
    expect(p.nextStep).toBe(5)
    expect(p.remaining).toEqual([{ rect: { x: 5, y: 0, w: 1810, h: 492 }, pieceIds: [bottom] }])
  })

  it('両方：済んだ工程 1〜5、次は無し。残りは 1810×79 の端材', () => {
    const p = sheetProgress(first, 3, [top, bottom])
    expect(p.doneSteps).toEqual([1, 2, 3, 4, 5])
    expect(p.nextStep).toBeNull()
    expect(p.remaining).toEqual([{ rect: { x: 5, y: 0, w: 1810, h: 79 }, pieceIds: [] }])
  })
})

describe('sheetProgress の性質（どの1枚・どの片でも）', () => {
  const withKerf = (kerf: number, list: SheetLayout[]) => list.map((s) => ({ s, kerf }))
  const all = [
    ...withKerf(3, sheets('vertical')),
    ...withKerf(3, sheets('horizontal')),
    ...withKerf(0, sheets('vertical', { kerf: 0, trim: 0 })),
    ...withKerf(4.5, sheets('horizontal', { kerf: 4.5, trim: 7 })),
  ]

  it('1片だけチェック：残りの材料に、ほかの片がちょうど1回ずつ入り、チェックした片とは重ならない', () => {
    for (const { s, kerf } of all) {
      for (const pl of s.placements) {
        const p = sheetProgress(s, kerf, [pl.pieceId])
        const ids = p.remaining.flatMap((r) => r.pieceIds)
        expect(ids.sort()).toEqual(s.placements.filter((x) => x !== pl).map((x) => x.pieceId).sort())
        for (const r of p.remaining) {
          expect(overlaps(r.rect, pl)).toBe(false)
          for (const id of r.pieceIds) expect(inside(r.rect, s.placements.find((x) => x.pieceId === id)!)).toBe(true)
        }
      }
    }
  })

  it('全部チェック：すべての工程が済み、次は無し、残りは端材だけ（端材は 30mm 以上）', () => {
    for (const { s, kerf } of all) {
      const p = sheetProgress(s, kerf, s.placements.map((x) => x.pieceId))
      expect(p.doneSteps).toEqual(s.cuts.map((c) => c.no))
      expect(p.nextStep).toBeNull()
      for (const r of p.remaining) {
        expect(r.pieceIds).toEqual([])
        expect(r.rect.w).toBeGreaterThanOrEqual(30)
        expect(r.rect.h).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('150片でもすぐ終わる', () => {
    const many = sheets('vertical', {}, (job) => {
      job.parts = job.parts.map((p) => (p.name === '棚板' ? { ...p, quantity: 150, expr: { ...p.expr, W: '80', D: '60' } } : p))
    })
    const t = performance.now()
    for (const s of many) {
      const ids = s.placements.map((x) => x.pieceId)
      for (let i = 0; i < ids.length; i += 7) sheetProgress(s, 3, ids.slice(0, i))
    }
    expect(performance.now() - t).toBeLessThan(2000)
  })
})

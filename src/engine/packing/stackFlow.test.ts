// E-73（第2.6版。architecture.md 18.4）：新しい木取りの流れ（重ねた板 → 端材 → 材料）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { BETA20, FLUSH25, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import { freezeSheet } from '../progress/frozen'
import type { Job, MaterialResult, PackingResult } from '../types'
import { packJob } from './index'
import { stackKey } from './stack'

const run = (job: Job) => packJob(job, computeDimensions(job))
const pct = (v: number) => Math.round(v * 1000) / 10
const find = (r: PackingResult, id: string) => r.materials.find((m) => m.boardId === id)
const pieces = (m: MaterialResult | undefined) => (m ? m.sheets.reduce((n, s) => n + s.placements.length, 0) : 0)
const NOW = new Date('2026-09-30T00:00:00.000Z')

describe('見本の値は変わらない', () => {
  it('見本（重ね切りオン）：組 3×6 5枚 85.2%・ラワン4 1枚 97.8%・全体 86.4%（背板は端材に入らない）', () => {
    for (const cutMode of ['vertical', 'horizontal', 'auto'] as const) {
      const job = sampleGroupJob(true)
      job.settings.cutMode = cutMode
      const r = run(job)
      const key = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
      expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.offcutSheetCount, pct(m.yieldRate)])).toEqual([
        [key, 5, 0, 85.2],
        [LAUAN_4_ID, 1, 0, 97.8],
      ])
      expect(pct(r.totalYieldRate)).toBe(86.4)
      expect(r.stacks).toEqual({ accepted: [{ key, boardIds: [MELAMINE_1_ID, LAUAN_4_ID] }], rejected: [] })
    }
  })

  it('本棚の見本：オン・オフとも ランバー 3枚・ベニヤ 1枚', () => {
    for (const stacking of ['on', 'off'] as const) {
      const job = bookshelfJob()
      job.stacking = stacking
      expect(run(job).materials.map((m) => [m.boardId, m.sheetCount])).toEqual([
        [LUMBER_18_ID, 3],
        [VENEER_4_ID, 1],
      ])
    }
  })
})

describe('重ねた板の端材を材料に使う', () => {
  /** ベタ20 の 1800×800 の部材 1枚（組 メラミン1＋ラワン18 が1つ・メラミン1 の残り 1）と、ラワン18 を直接選んだ 1000×90 の部材 */
  function betaJob(): Job {
    return stackJob([groupPart('側板', BETA20, 1800, 800, 1), boardPart('桟', L18, 1000, 90, 1)])
  }

  it('ラワン18 の材料の行は 新しい板 0枚・端材から 1枚。端材の1枚は端切りなしで、使える範囲が端材の大きさ', () => {
    const r = run(betaJob())
    const key = stackKey(MEL, L18)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.offcutSheetCount])).toEqual([
      [MEL, 1, 0],
      [key, 1, 0],
      [L18, 0, 1],
    ])
    const s = find(r, L18)!.sheets[0]
    expect(s.sheet).toEqual({ stockId: `offcut:${key}#1:0`, sizeKind: 'custom', grain: 'long', offcut: { source: 1 } })
    expect([s.boardWidth, s.boardLength]).toEqual([102, 1820])
    expect(s.trims).toEqual([])
    expect(s.usable).toEqual({ x: 0, y: 0, w: 102, h: 1820 })
    expect(s.cuts.some((c) => c.kind === 'trim')).toBe(false)
    expect(s.placements.map((p) => p.partId)).toEqual(['桟'])
  })

  it('全体の歩留まり：重ねた板は2枚、端材の1枚は板の面積に数えず片だけ数える', () => {
    const r = run(betaJob())
    const board = 910 * 1820
    const used = 1800 * 800 * 3 + 1000 * 90
    // 板：メラミン1 の1枚 ＋ 重ねた板 ×2
    expect(r.totalYieldRate).toBeCloseTo(used / (board * 3), 10)
  })

  it('重ね切りオフなら端材は無く、メラミン1 は2枚・ラワン18 は新しい板1枚（側板の横に桟）', () => {
    const r = run(stackJob(betaJob().parts, 'off'))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.offcutSheetCount])).toEqual([
      [MEL, 2, 0],
      [L18, 1, 0],
    ])
    expect(r.stacks).toEqual({ accepted: [], rejected: [] })
  })

  it('横切り優先でも端材から取る（端材の1枚は端切りなし）', () => {
    const job = betaJob()
    job.settings.cutMode = 'horizontal'
    const r = run(job)
    const m = find(r, L18)!
    expect([m.sheetCount, m.offcutSheetCount]).toEqual([0, 1])
    expect(m.sheets[0].trims).toEqual([])
  })

  it('端材にも入らず、選んだサイズにも入らない片は tooLarge（手持ちでない材料）', () => {
    const job = betaJob()
    job.parts.push(boardPart('大板', L18, 2000, 950, 1))
    const m = find(run(job), L18)!
    expect(m.unplaced).toEqual([{ partId: '大板', name: '大板', reason: 'tooLarge' }])
    expect([m.sheetCount, m.offcutSheetCount]).toEqual([0, 1])
  })

  it('端材から取った1枚を固定すると、その端材の行から引かれ、同じ部材を足しても新しい板に並ぶ', () => {
    let job = betaJob()
    const r = run(job)
    const m = find(r, L18)!
    job = { ...job, frozenSheets: [freezeSheet(job, L18, m.mode, m.sheets[0], 'f1', NOW)] }
    expect(job.frozenSheets[0].layout.sheet?.offcut).toEqual({ source: 1 })
    job.parts = job.parts.map((p) => (p.id === '桟' ? { ...p, quantity: 2 } : p))
    const m2 = find(run(job), L18)!
    expect([m2.sheetCount, m2.offcutSheetCount]).toEqual([1, 0])
  })
})

describe('固定した重ねた板', () => {
  it('重ねた板の1枚を固定すると、その部材の残りが a・b とも1つずつ減る（組 4 → 3）', () => {
    let job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 2)])
    const r = run(job)
    const g = find(r, stackKey(MEL, L4))!
    expect(g.sheetCount).toBe(4)
    job = { ...job, frozenSheets: [freezeSheet(job, MEL, g.mode, g.sheets[0], 'f1', NOW, L4)] }
    const r2 = run(job)
    expect(find(r2, stackKey(MEL, L4))!.sheetCount).toBe(3)
    expect(find(r2, MEL)).toBeUndefined()
    expect(find(r2, L4)).toBeUndefined()
  })

  it('固定した重ねた板の端材は、重ね切りをオフにしても手持ちの行に残る', () => {
    let job = stackJob([groupPart('側板', BETA20, 1800, 800, 1), boardPart('桟', L18, 1000, 90, 1)])
    const g = find(run(job), stackKey(MEL, L18))!
    job = { ...job, frozenSheets: [freezeSheet(job, MEL, g.mode, g.sheets[0], 'f1', NOW, L18)], stacking: 'off' }
    const m = find(run(job), L18)!
    expect([m.sheetCount, m.offcutSheetCount]).toEqual([0, 1])
    expect(m.sheets[0].sheet?.stockId).toBe('offcut:f1:0')
  })
})

describe('計算量', () => {
  it('部材 150枚（材料グループ・直接選んだ部材）で packJob が 1秒以内', () => {
    const parts = []
    for (let i = 0; i < 15; i++) {
      parts.push(groupPart(`g${i}`, i % 2 ? FLUSH25 : BETA20, 300 + i * 37, 200 + i * 23, 3, 'any'))
      parts.push(boardPart(`d${i}`, i % 3 ? L18 : L4, 200 + i * 41, 60 + i * 11, 5, 'any'))
    }
    const job = stackJob(parts)
    const dims = computeDimensions(job)
    const t = performance.now()
    const r = packJob(job, dims)
    const took = performance.now() - t
    const total = r.materials.reduce((n, m) => n + pieces(m), 0)
    expect(total).toBeGreaterThan(150)
    expect(took).toBeLessThan(1000)
  }, 10_000)
})

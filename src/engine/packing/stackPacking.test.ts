import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { frozenDemand } from '../progress/frozen'
import type { FrozenSheet, Job, SheetLayout } from '../types'
import { packJob } from './index'
import { expandPieces } from './pieces'
import { stackKey, stackPlan } from './stack'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const pct = (r: number) => Math.round(r * 1000) / 10
const run = (job: Job) => packJob(job, computeDimensions(job))
const names = (s: SheetLayout) => s.placements.map((p) => p.name)

function frozen(layout: SheetLayout, stackWith?: boolean): FrozenSheet {
  return {
    id: 'sheet-1',
    boardId: MELAMINE_1_ID,
    material: 'メラミン',
    thickness: 1,
    grain: 'long',
    mode: 'vertical',
    kerf: 3,
    trim: 5,
    layout,
    checked: [layout.placements[0].pieceId],
    frozenAt: '2026-09-27T00:00:00.000Z',
    ...(stackWith ? { stackWith: { boardId: LAUAN_4_ID, material: 'ラワン', thickness: 4 } } : {}),
  }
}

describe('重ね切りの木取り（E-51）', () => {
  it('見本で重ね切りオン：組が5枚（85.2%）、ラワン 4 のふつうの1枚が1枚（背板）、メラミン 1 のふつうの結果は無い', () => {
    const r = run(sampleGroupJob(true))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 97.8],
    ])
    const g = r.materials[0]
    expect(g.stack).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID] })
    expect([g.material, g.thickness]).toEqual(['メラミン', 1])
    expect(g.sheets.map(names)).toEqual([
      ['側板', '側板'],
      ['側板', '側板'],
      ['天地板', '天地板', '天地板', '天地板'],
      ['棚板', '棚板', '棚板', '棚板'],
      ['棚板', '棚板', '棚板', '棚板'],
    ])
    expect(g.sheets.flatMap(names)).not.toContain('背板')
    expect(r.materials[1].sheets.map(names)).toEqual([['背板']])
    expect(r.materials[1].stack).toBeUndefined()
    // 全体の歩留まりは組の1枚を2回数える（重ねないときと同じ）
    expect(pct(r.totalYieldRate)).toBe(86.4)
  })

  it('組の片の id は重ならない（a の表面材の番号）', () => {
    const job = sampleGroupJob(true)
    const e = expandPieces(job, computeDimensions(job))
    const g = e.groups.find((x) => x.stack?.key === KEY)!
    expect(g.board.id).toBe(MELAMINE_1_ID)
    expect(g.pieces).toHaveLength(16)
    expect(new Set(g.pieces.map((p) => p.pieceId)).size).toBe(16)
    expect(g.pieces.filter((p) => p.partId === 'part-gawa').map((p) => p.pieceId)).toEqual([
      'part-gawa#1', 'part-gawa#2', 'part-gawa#3', 'part-gawa#4',
    ])
  })

  it('オフなら S-14 の値のまま（メラミン 1 が5枚 85.2%・ラワン 4 が6枚 87.3%・全体 86.4%）', () => {
    const r = run(sampleGroupJob(false))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [MELAMINE_1_ID, 5, 85.2],
      [LAUAN_4_ID, 6, 87.3],
    ])
    expect(pct(r.totalYieldRate)).toBe(86.4)
    expect(r.materials.every((m) => m.stack === undefined)).toBe(true)
  })

  it('横切り優先・おまかせでも組は5枚', () => {
    for (const cutMode of ['horizontal', 'auto'] as const) {
      const job = sampleGroupJob(true)
      job.settings.cutMode = cutMode
      const r = run(job)
      expect(r.materials.map((m) => [m.boardId, m.sheetCount])).toEqual([[KEY, 5], [LAUAN_4_ID, 1]])
    }
  })

  it('ラワン 4 を 4×8 にしても重ねたまま（第2.3版）：組は組の設定 3×6 で5枚、背板は 4×8', () => {
    const job = sampleGroupJob(true)
    job.boards = job.boards.map((b) => (b.id === LAUAN_4_ID ? { ...b, sizeKind: 'shihachi', width: 1220, length: 2440 } : b))
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)])).toEqual([
      [KEY, 5, 85.2],
      [LAUAN_4_ID, 1, 54.4],
    ])
  })

  it('メラミン 1 を短手の自由入力にしても、組は組の設定（3×6・長手）で並ぶ', () => {
    const job = sampleGroupJob(true)
    job.boards = job.boards.map((b) => (b.id === MELAMINE_1_ID ? { ...b, grain: 'short', sizeKind: 'custom' } : b))
    expect(run(job).materials.map((m) => [m.boardId, m.sheetCount])).toEqual([[KEY, 5], [LAUAN_4_ID, 1]])
  })

  it('plan を渡すと、その組だけ重ねる（空の plan なら重ねない）', () => {
    const job = sampleGroupJob(true)
    const r = packJob(job, computeDimensions(job), { groups: [] })
    expect(r.materials.map((m) => [m.boardId, m.sheetCount])).toEqual([[MELAMINE_1_ID, 5], [LAUAN_4_ID, 6]])
    expect(packJob(job, computeDimensions(job), stackPlan(job)).materials[0].boardId).toBe(KEY)
  })

  it('stackWith 付きの固定した1枚（側板×2）があると両方の材料から引き、組が4枚', () => {
    const job = sampleGroupJob(true)
    const first = run(job).materials[0].sheets[0]
    job.frozenSheets = [frozen(first, true)]
    const d = frozenDemand(job)
    expect(d.get(`part-gawa|${MELAMINE_1_ID}`)).toBe(2)
    expect(d.get(`part-gawa|${LAUAN_4_ID}`)).toBe(2)
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount])).toEqual([[KEY, 4], [LAUAN_4_ID, 1]])
  })

  it('stackWith の無い固定した1枚（メラミン 1 だけ 側板×2）なら、差の 側板×2 はラワン 4 にふつうに並ぶ', () => {
    const job = sampleGroupJob(true)
    const first = run(job).materials[0].sheets[0]
    job.frozenSheets = [frozen(first, false)]
    const r = run(job)
    expect(r.materials.map((m) => [m.boardId, m.sheetCount])).toEqual([[KEY, 4], [LAUAN_4_ID, 2]])
    expect(r.materials[1].sheets.flatMap(names).sort()).toEqual(['側板', '側板', '背板'].sort())
    const ids = r.materials[1].sheets.flatMap((s) => s.placements.map((p) => p.pieceId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('以前の cutByBoard でラワン 4 だけ木取り済みの部材（側板）は重ねずにメラミン 1 に出る', () => {
    const job = sampleGroupJob(true)
    job.parts = job.parts.map((p) =>
      p.id === 'part-gawa' ? { ...p, checks: { ...p.checks, cutByBoard: { [LAUAN_4_ID]: true } } } : p,
    )
    const r = run(job)
    expect(r.materials.map((m) => m.boardId)).toEqual([MELAMINE_1_ID, KEY, LAUAN_4_ID])
    expect(r.materials[0].sheets.flatMap(names)).toEqual(['側板', '側板', '側板', '側板'])
    expect(r.materials[1].sheets.flatMap(names)).not.toContain('側板')
    expect(r.done).toEqual([{ partId: 'part-gawa', name: '側板', quantity: 4, boardId: LAUAN_4_ID }])
  })
})

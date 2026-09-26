import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { CutMode, Job, Part } from '../types'
import { MIN_SCRAP, packJob } from './index'

const pct = (r: number) => Math.round(r * 1000) / 10

function run(job: Job) {
  return packJob(job, computeDimensions(job))
}

function withMode(mode: CutMode): Job {
  const job = bookshelfJob()
  job.settings.cutMode = mode
  return job
}

function addPart(job: Job, p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>) {
  job.parts.push({
    boardId: LUMBER_18_ID,
    thicknessAxis: null,
    quantity: 1,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    clearance: {},
    allowance: null,
    ...p,
  })
}

/** ランバー18 だけの仕事（見本の部材を外して、指定の部材を足す） */
function lumberOnly(mode: CutMode, parts: (Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>)[]): Job {
  const job = withMode(mode)
  job.parts = job.parts.filter((p) => p.name === '全体')
  for (const p of parts) addPart(job, p)
  return job
}

describe('入口から出すもの', () => {
  it('端材として出す最小の大きさ（MIN_SCRAP）を入口から使える', () => {
    expect(MIN_SCRAP).toBe(30)
  })
})

describe('packJob（木取り計算の入口）', () => {
  it('見本・縦切り優先：材料が2つ（板の登録順）、必要枚数 3 と 1', () => {
    const r = run(bookshelfJob())
    expect(r.materials.map((m) => [m.boardId, m.material, m.thickness, m.mode, m.sheetCount])).toEqual([
      [LUMBER_18_ID, 'シナランバー', 18, 'vertical', 3],
      [VENEER_4_ID, 'シナベニヤ', 4, 'vertical', 1],
    ])
    expect(r.skipped).toEqual([])
    expect(r.materials.every((m) => m.unplaced.length === 0)).toBe(true)
  })

  it('見本・縦切り優先：1枚目 側板×2、2枚目 天地板×2＋棚板×2、3枚目 棚板×2', () => {
    const lumber = run(bookshelfJob()).materials[0]
    expect(lumber.sheets.map((s) => s.placements.map((p) => p.name))).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板'],
      ['棚板', '棚板'],
    ])
    expect(lumber.sheets.map((s) => s.index)).toEqual([1, 2, 3])
  })

  it('見本・縦切り優先の歩留まり：89.6 / 84.4 / 41.1、ランバー 71.7、ベニヤ 97.8、全体 78.2（%）', () => {
    const r = run(bookshelfJob())
    const [lumber, veneer] = r.materials
    expect(lumber.sheets.map((s) => pct(s.yieldRate))).toEqual([89.6, 84.4, 41.1])
    expect(lumber.sheets[0].usedArea).toBe(1_484_200)
    expect(pct(lumber.yieldRate)).toBe(71.7)
    expect(pct(veneer.yieldRate)).toBe(97.8)
    expect(pct(r.totalYieldRate)).toBe(78.2)
  })

  it('板ごとに大きさ・使える範囲・切る順番・端材が入る', () => {
    const s1 = run(bookshelfJob()).materials[0].sheets[0]
    expect([s1.boardWidth, s1.boardLength]).toEqual([910, 1820])
    expect(s1.usable).toEqual({ x: 0, y: 0, w: 905, h: 1820 })
    expect(s1.orientation).toBe('portrait')
    expect(s1.trims).toEqual([{ x: 905, y: 0, w: 5, h: 1820 }])
    expect(s1.cuts[0]).toMatchObject({ no: 1, kind: 'trim', direction: 'vertical', at: 905 })
    expect(s1.cuts[1]).toMatchObject({ no: 2, kind: 'strip', direction: 'vertical', label: '右端から 410mm で縦に切る' })
    expect(s1.scraps).toEqual([{ x: 0, y: 0, w: 79, h: 1820 }])
  })

  it('見本・横切り優先：シナランバー18 は3枚、シナベニヤ4 は1枚、切り方は横切り優先', () => {
    const r = run(withMode('horizontal'))
    expect(r.materials.map((m) => [m.mode, m.sheetCount])).toEqual([
      ['horizontal', 3],
      ['horizontal', 1],
    ])
    expect(r.materials[0].sheets.map((s) => s.placements.map((p) => p.name))).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板'],
      ['棚板', '棚板'],
    ])
  })

  it('見本・横切り優先の歩留まり：縦切り優先と同じ 89.6 / 84.4 / 41.1、ランバー 71.7、ベニヤ 97.8、全体 78.2（%）', () => {
    const r = run(withMode('horizontal'))
    const [lumber, veneer] = r.materials
    expect(lumber.sheets.map((s) => pct(s.yieldRate))).toEqual([89.6, 84.4, 41.1])
    expect(pct(lumber.yieldRate)).toBe(71.7)
    expect(pct(veneer.yieldRate)).toBe(97.8)
    expect(pct(r.totalYieldRate)).toBe(78.2)
  })

  it('見本・横切り優先の1枚目：横長（landscape）、使える範囲 1815×905、端切りは上の長手と右の妻手、側板は右上から', () => {
    const s1 = run(withMode('horizontal')).materials[0].sheets[0]
    expect(s1.orientation).toBe('landscape')
    expect([s1.boardWidth, s1.boardLength]).toEqual([910, 1820])
    expect(s1.usable).toEqual({ x: 0, y: 0, w: 1815, h: 905 })
    expect(s1.trims).toEqual([
      { x: 0, y: 905, w: 1820, h: 5 },
      { x: 1815, y: 0, w: 5, h: 905 },
    ])
    expect(s1.placements.map((p) => [p.x, p.y, p.w, p.h])).toEqual([
      [5, 495, 1810, 410],
      [5, 82, 1810, 410],
    ])
    expect(s1.cuts.map((c) => c.label)).toEqual([
      '端切り：上の長手を 5mm 落とす（横に切る）',
      '端切り：右の妻手を 5mm 落とす（縦に切る）',
      '右端から 1810mm で縦に切る',
      '上端から 410mm で横に切る',
      '上端から 410mm で横に切る',
    ])
    expect(s1.scraps).toEqual([{ x: 5, y: 0, w: 1810, h: 79 }])
  })

  it('横切り優先：長手 1816 以上の部材は、右の妻手を端切りするので入らない（1815 は入る）', () => {
    const parts = [
      { id: 'a', name: 'ぴったり', expr: { W: '290', H: '18', D: '1805' }, grain: 'D' as const },
      { id: 'b', name: '1mm多い', expr: { W: '290', H: '18', D: '1806' }, grain: 'D' as const },
    ]
    const h = run(lumberOnly('horizontal', parts)).materials[0]
    expect(h.unplaced).toEqual([{ partId: 'b', name: '1mm多い', reason: 'tooLarge' }])
    expect(h.sheets.flatMap((s) => s.placements.map((p) => p.name))).toEqual(['ぴったり'])
    // 縦切り優先なら長手は 1820 まで使えるので両方入る
    expect(run(lumberOnly('vertical', parts)).materials[0].unplaced).toEqual([])
  })

  it('おまかせ：横切り優先で入らない部材があれば、全部入る縦切り優先を採る', () => {
    const parts = [
      { id: 'a', name: '長い板', expr: { W: '290', H: '18', D: '1810' }, grain: 'D' as const },
      { id: 'b', name: '短い板', expr: { W: '290', H: '18', D: '300' }, quantity: 5, grain: 'D' as const },
    ]
    const auto = run(lumberOnly('auto', parts)).materials[0]
    expect(auto.mode).toBe('vertical')
    expect(auto.unplaced).toEqual([])
  })

  it('見本・おまかせ：枚数が同じ（3枚）なので、一番大きい端材が大きい縦切り優先（512×1820 > 939×905）を採る', () => {
    const r = run(withMode('auto'))
    expect(r.materials.map((m) => [m.mode, m.sheetCount])).toEqual([
      ['vertical', 3],
      ['vertical', 1],
    ])
    expect(run(withMode('horizontal')).materials[0].sheets[2].scraps[0]).toMatchObject({ w: 939, h: 905 })
  })

  it('おまかせ：必要な板が少ないほうを採る（横切り優先なら1枚、縦切り優先なら2枚）', () => {
    const parts = [
      // 木目 D を長辺方向（y）に置く：木取り x299×y1500 が3枚、x900×y300 が1枚
      { id: 'a', name: '縦長', expr: { W: '289', H: '18', D: '1490' }, quantity: 3, grain: 'D' as const },
      { id: 'b', name: '横長', expr: { W: '890', H: '18', D: '290' }, quantity: 1, grain: 'D' as const },
    ]
    expect(run(lumberOnly('vertical', parts)).materials[0].sheetCount).toBe(2)
    expect(run(lumberOnly('horizontal', parts)).materials[0].sheetCount).toBe(1)
    const auto = run(lumberOnly('auto', parts)).materials[0]
    expect([auto.mode, auto.sheetCount]).toEqual(['horizontal', 1])
  })

  it('おまかせ：枚数が同じなら、一番大きい端材が大きいほう（横切り優先 812×905 > 縦切り優先 402×1820）', () => {
    const parts = [{ id: 'a', name: '板', expr: { W: '490', H: '18', D: '990' }, grain: 'D' as const }]
    const v = run(lumberOnly('vertical', parts)).materials[0]
    const h = run(lumberOnly('horizontal', parts)).materials[0]
    expect(v.sheets[0].scraps[0]).toMatchObject({ w: 402, h: 1820 })
    expect(h.sheets[0].scraps[0]).toMatchObject({ x: 0, y: 0, w: 812, h: 905 })
    expect(run(lumberOnly('auto', parts)).materials[0].mode).toBe('horizontal')
  })

  it('おまかせ：枚数も一番大きい端材も同じなら縦切り優先（使える範囲いっぱいの 905×1815 の片）', () => {
    const parts = [{ id: 'a', name: '板', expr: { W: '895', H: '18', D: '1805' }, grain: 'D' as const }]
    expect(run(lumberOnly('vertical', parts)).materials[0].sheets[0].scraps).toEqual([])
    expect(run(lumberOnly('horizontal', parts)).materials[0].sheets[0].scraps).toEqual([])
    expect(run(lumberOnly('auto', parts)).materials[0].mode).toBe('vertical')
  })

  it('板に入らない部材は一覧に出し、ほかの部材は計算する', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'big', name: '大きい板', expr: { W: '990', H: '18', D: '1990' }, quantity: 2 })
    const lumber = run(job).materials[0]
    expect(lumber.unplaced).toEqual([{ partId: 'big', name: '大きい板', reason: 'tooLarge' }])
    expect(lumber.sheetCount).toBe(3)
  })

  it('入らない部材しかない板も、0枚として一覧に出す', () => {
    const job = lumberOnly('vertical', [{ id: 'big', name: '大きい板', expr: { W: '990', H: '18', D: '1990' } }])
    const r = run(job)
    expect(r.materials).toHaveLength(1)
    expect(r.materials[0]).toMatchObject({ sheetCount: 0, sheets: [], yieldRate: 0 })
    expect(r.totalYieldRate).toBe(0)
  })

  it('計算できない部材（寸法エラー・板なし）は skipped に出し、ほかは計算する', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'err', name: 'エラー', expr: { W: '天板.W', H: '18', D: '100' } })
    addPart(job, { id: 'nb', name: '板なし', boardId: null, expr: { W: '100', H: '18', D: '100' } })
    const r = run(job)
    expect(r.skipped).toEqual([
      { partId: 'err', name: 'エラー', reason: 'dimensionError' },
      { partId: 'nb', name: '板なし', reason: 'noBoard' },
    ])
    expect(r.materials.map((m) => m.sheetCount)).toEqual([3, 1])
  })

  it('部材が1枚もなければ材料なし・全体の歩留まり 0', () => {
    const job = bookshelfJob()
    job.parts = []
    expect(run(job)).toEqual({ materials: [], totalYieldRate: 0, skipped: [] })
  })

  it('部材120枚（10種類）のおまかせが1秒以内に終わり、すべて配置される', () => {
    const job = lumberOnly(
      'auto',
      Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        name: `部材${i + 1}`,
        expr: { W: String(150 + i * 60), H: '18', D: String(200 + ((i * 97) % 500)) },
        quantity: 12,
        grain: (i % 3 === 0 ? 'any' : 'W') as Part['grain'],
      })),
    )
    const t = performance.now()
    const r = run(job)
    expect(performance.now() - t).toBeLessThan(1000)
    const m = r.materials[0]
    expect(m.sheets.reduce((n, s) => n + s.placements.length, 0)).toBe(120)
    expect(m.unplaced).toEqual([])
  })

  it('150枚のおまかせ（寸法の計算込み）も1秒を大きく下回る', () => {
    const job = lumberOnly(
      'auto',
      Array.from({ length: 15 }, (_, i) => ({
        id: `q${i}`,
        name: `棚${i + 1}`,
        expr: { W: String(100 + ((i * 131) % 780)), H: '18', D: String(80 + ((i * 71) % 600)) },
        quantity: 10,
        grain: (i % 2 === 0 ? 'any' : 'D') as Part['grain'],
      })),
    )
    const t = performance.now()
    const r = packJob(job, computeDimensions(job))
    expect(performance.now() - t).toBeLessThan(300)
    expect(r.materials[0].sheets.reduce((n, s) => n + s.placements.length, 0)).toBe(150)
  })
})

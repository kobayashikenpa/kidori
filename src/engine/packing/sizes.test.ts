import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { Job, Part } from '../types'
import { packJob } from './index'
import { compareStandardSizes, pickBetterSize, type SizeSummary } from './sizes'

const pct = (r: number) => Math.round(r * 1000) / 10

function compare(job: Job) {
  return compareStandardSizes(job, computeDimensions(job))
}

/** 比べた結果を [boardId, [種類, 枚数, 歩留まり%, 入らない数]…] にまとめる */
function summary(job: Job) {
  return compare(job).map((c) => [c.boardId, c.options.map((o) => [o.kind, o.sheetCount, pct(o.yieldRate), o.unplacedCount])])
}

function part(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
  return {
    boardId: LUMBER_18_ID,
    thicknessAxis: 'D',
    quantity: 1,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
    ...p,
  }
}

describe('compareStandardSizes（材料のサイズの比較：3×6 と 4×8）', () => {
  it('見本・縦切り優先：シナランバー 18 は 3×6 3枚 71.7%・4×8 2枚 59.8%、シナベニヤ 4 はどちらも 1枚', () => {
    expect(summary(bookshelfJob())).toEqual([
      [
        LUMBER_18_ID,
        [
          ['saburoku', 3, 71.7, 0],
          ['shihachi', 2, 59.8, 0],
        ],
      ],
      [
        VENEER_4_ID,
        [
          ['saburoku', 1, 97.8, 0],
          ['shihachi', 1, 54.4, 0],
        ],
      ],
    ])
  })

  it('3×6 は 910×1820、4×8 は 1220×2440', () => {
    const [lumber] = compare(bookshelfJob())
    expect(lumber.options.map((o) => [o.kind, o.width, o.length])).toEqual([
      ['saburoku', 910, 1820],
      ['shihachi', 1220, 2440],
    ])
  })

  it('材料の並びが packJob と同じ（部材の無い材料は出さない）', () => {
    const job = bookshelfJob()
    // 部材の無い材料を先頭に足し、ベニヤを先にする
    job.boards = [
      { id: 'empty', material: 'メラミン', thickness: 1, sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' },
      job.boards[1],
      job.boards[0],
    ]
    const ids = compare(job).map((c) => c.boardId)
    expect(ids).toEqual(packJob(job, computeDimensions(job)).materials.map((m) => m.boardId))
    expect(ids).toEqual([VENEER_4_ID, LUMBER_18_ID])
  })

  it('今のサイズが 4×8 や自由入力でも、3×6・4×8 で比べる', () => {
    const job = bookshelfJob()
    Object.assign(job.boards[0], { sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' })
    Object.assign(job.boards[1], { sizeKind: 'shihachi', width: 1220, length: 2440 })
    expect(summary(job)).toEqual(summary(bookshelfJob()))
  })

  it('計算の前後で仕事のデータが変わらない', () => {
    const job = bookshelfJob()
    Object.assign(job.boards[0], { sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' })
    const before = structuredClone(job)
    compare(job)
    expect(job).toEqual(before)
  })

  it('木取り済みの部材は除かれる（棚板を完了にすると 3×6 で 2枚）', () => {
    const job = bookshelfJob()
    job.parts.find((p) => p.name === '棚板')!.checks.cut = true
    expect(compare(job)[0].options.map((o) => o.sheetCount)).toEqual([2, 2])
  })

  it('3×6 に入らず 4×8 なら入る部材：3×6 は入らない部材 1、4×8 は 0', () => {
    const job = bookshelfJob()
    job.boards = job.boards.filter((b) => b.id === LUMBER_18_ID)
    // 1000×2000（木取り 1010×2010）：3×6 の使える範囲 905×1820 に入らない。4×8（1215×2440）には入る
    job.parts = [part({ id: 'big', name: '大板', expr: { W: '1000', H: '2000', D: '18' } })]
    expect(summary(job)).toEqual([
      [
        LUMBER_18_ID,
        [
          ['saburoku', 0, 0, 1],
          ['shihachi', 1, 68.2, 0],
        ],
      ],
    ])
  })

  it('4×8 ぴったり（使える幅 1215）と 1mm 超え', () => {
    const job = bookshelfJob()
    job.boards = job.boards.filter((b) => b.id === LUMBER_18_ID)
    job.parts = [part({ id: 'fit', name: 'ぴったり', expr: { W: '1205', H: '2000', D: '18' }, grain: 'H' })]
    expect(compare(job)[0].options[1].unplacedCount).toBe(0)
    job.parts[0].expr.W = '1206'
    expect(compare(job)[0].options[1].unplacedCount).toBe(1)
  })

  it('部材が無ければ空', () => {
    const job = bookshelfJob()
    job.parts = []
    expect(compare(job)).toEqual([])
  })

  it('部材150枚・おまかせで 1秒以内', () => {
    const job = bookshelfJob()
    job.settings.cutMode = 'auto'
    job.parts = []
    for (let i = 0; i < 50; i++) {
      job.parts.push(
        part({
          id: `p${i}`,
          name: `部材${i}`,
          expr: { W: String(100 + ((i * 37) % 400)), H: String(150 + ((i * 53) % 900)), D: '18' },
          quantity: 3,
          grain: i % 3 === 0 ? 'any' : 'H',
        }),
      )
    }
    const dims = computeDimensions(job)
    const t = performance.now()
    const r = compareStandardSizes(job, dims)
    expect(performance.now() - t).toBeLessThan(1000)
    expect(r).toHaveLength(1)
    expect(r[0].options[0].sheetCount).toBeGreaterThan(r[0].options[1].sheetCount)
  })
})

describe('枚数が少ない方・歩留まりが高い方（fewer・higher）', () => {
  it('見本：シナランバー 18 は枚数が少ないのが 4×8、歩留まりが高いのが 3×6', () => {
    const [lumber] = compare(bookshelfJob())
    expect([lumber.fewer, lumber.higher]).toEqual(['shihachi', 'saburoku'])
  })

  it('枚数が同じ（シナベニヤ 4 はどちらも 1枚）なら枚数の印は無し、歩留まりは 3×6', () => {
    const [, veneer] = compare(bookshelfJob())
    expect([veneer.fewer, veneer.higher]).toEqual([null, 'saburoku'])
  })

  it('入らない部材が出るサイズがあれば比べない（どちらも印は無し）', () => {
    const job = bookshelfJob()
    job.boards = job.boards.filter((b) => b.id === LUMBER_18_ID)
    job.parts = [part({ id: 'big', name: '大板', expr: { W: '1000', H: '2000', D: '18' } })]
    const [r] = compare(job)
    expect([r.fewer, r.higher]).toEqual([null, null])
  })

  const opt = (kind: SizeSummary['kind'], sheetCount: number, yieldRate: number, unplacedCount = 0): SizeSummary => ({
    kind,
    width: kind === 'saburoku' ? 910 : 1220,
    length: kind === 'saburoku' ? 1820 : 2440,
    sheetCount,
    yieldRate,
    unplacedCount,
  })

  it('歩留まりが小数第1位（0.1%）で同じなら印は無し', () => {
    expect(pickBetterSize([opt('saburoku', 3, 0.7171), opt('shihachi', 2, 0.7174)])).toEqual({ fewer: 'shihachi', higher: null })
  })

  it('歩留まりが 0.1% 違えば高い方に印', () => {
    expect(pickBetterSize([opt('saburoku', 2, 0.717), opt('shihachi', 2, 0.718)])).toEqual({ fewer: null, higher: 'shihachi' })
  })

  it('片方に入らない部材があれば、もう片方が良くても印は無し', () => {
    expect(pickBetterSize([opt('saburoku', 1, 0.9, 1), opt('shihachi', 2, 0.5)])).toEqual({ fewer: null, higher: null })
  })

  it('枚数が 0 のサイズは比べない', () => {
    expect(pickBetterSize([opt('saburoku', 0, 0), opt('shihachi', 1, 0.5)])).toEqual({ fewer: null, higher: null })
  })
})

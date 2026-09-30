// E-69：同じ幅を優先する並べ方は、必要な板が増えないときだけ使う（仕様書 8。オーナー決定 B）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { defaultSettings } from '../defaults'
import type { Board, CutMode, Job, Part, PackingResult } from '../types'
import { packJob } from './index'

/** 部材（W×H、厚み D＝18。木目は H＝板の長手方向なので、縦切り優先では W が帯の幅になる） */
function part(id: string, w: number, h: number, quantity = 1): Part {
  return {
    id,
    name: id,
    boardId: 'b18',
    expr: { W: String(w), H: String(h), D: '18' },
    thicknessAxis: 'D',
    quantity,
    grain: 'H',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
  }
}

/** 3×6（910×1820）のラワン18。刃厚・端切り 0 で帯の幅・長さをそのまま数えられるようにする */
function job(parts: Part[], cutMode: CutMode = 'vertical', board: Partial<Board> = {}): Job {
  return {
    id: 'j',
    name: '仕事',
    settings: { ...defaultSettings(), kerf: 0, trim: 0, cutMode },
    boards: [{ id: 'b18', material: 'ラワン', thickness: 18, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', ...board }],
    flushes: [],
    parts,
    frozenSheets: [],
    stackSheets: [],
    stacking: 'on',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const run = (j: Job, sameWidthFirst?: boolean) =>
  packJob(j, computeDimensions(j), undefined, sameWidthFirst === undefined ? {} : { sameWidthFirst })

/** 1枚目の片ごとの x（右から詰めた帯の位置） */
const xs = (r: PackingResult) => Object.fromEntries(r.materials[0].sheets[0].placements.map((p) => [p.pieceId, p.x]))

describe('同じ幅を優先するのは板が増えないときだけ（E-69）', () => {
  // A 546×546 の帯の残りの長さ（1274）に B 364×546 が入る。同じ幅を優先すると B が新しい帯（幅 364）を作り、
  // 板の幅（910）を使い切るので、C 318×1820 が2枚目になる。今までの並べ方なら C は B の左の新しい帯に入って1枚
  const worse = () => job([part('A', 546, 546), part('B', 364, 546), part('C', 318, 1820)])

  it('同じ幅を優先すると1枚増える仕事：それだけで並べると2枚、今までの並べ方なら1枚', () => {
    expect(run(worse(), true).materials[0].sheetCount).toBe(2)
    expect(run(worse(), false).materials[0].sheetCount).toBe(1)
  })

  it('初期値は両方を計算して、板の少ない今までの並べ方を使う（配置も今までの並べ方と同じ）', () => {
    const r = run(worse())
    expect(r.materials[0].sheetCount).toBe(1)
    expect(r.materials[0].sheets).toEqual(run(worse(), false).materials[0].sheets)
    expect(r.materials[0].unplaced).toEqual([])
  })

  it('板の枚数が同じなら、同じ幅を優先する並べ方を使う', () => {
    // B・C（幅 364）は 同じ幅を優先すると2本目の帯に縦に並び、今までの並べ方だと A の帯に入る。どちらも1枚
    const j = () => job([part('A', 546, 546), part('B', 364, 546), part('C', 364, 546)])
    const same = run(j(), true)
    const old = run(j(), false)
    expect([same.materials[0].sheetCount, old.materials[0].sheetCount]).toEqual([1, 1])
    expect(xs(old)).not.toEqual(xs(same))
    const r = run(j())
    expect(r.materials[0].sheets).toEqual(same.materials[0].sheets)
    // A は右端の帯、B・C は その左の幅 364 の帯（右から詰め、余りは左）
    const x = xs(r)
    expect(Object.values(x).sort((a, b) => a - b)).toEqual([0, 0, 364])
  })

  it('おまかせでも、並べ方ごとに縦切り・横切りを選んでから枚数で比べる', () => {
    const r = run(job(worse().parts, 'auto'))
    expect(r.materials[0].sheetCount).toBe(1)
  })

  it('手持ちの材料（1行・1枚）でも行ごとに比べる：同じ幅を優先すると入らない片が出るときは今までの並べ方', () => {
    const stock = { stockOn: true as const, stock: [{ id: 's1', sizeKind: 'saburoku' as const, width: 910, length: 1820, grain: 'long' as const, count: 1 }] }
    const onlySame = run(job(worse().parts, 'vertical', stock), true)
    expect(onlySame.materials[0].unplaced.map((u) => u.partId)).toEqual(['C'])
    const r = run(job(worse().parts, 'vertical', stock))
    expect(r.materials[0].sheetCount).toBe(1)
    expect(r.materials[0].unplaced).toEqual([])
    expect(r.materials[0].sheets[0].sheet?.stockId).toBe('s1')
  })

  it('材料ごとに別々に選ぶ：板が増える材料は今までの並べ方、増えない材料は同じ幅を優先', () => {
    const j = worse()
    j.boards.push({ id: 'b9', material: 'ラワン', thickness: 9, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
    j.parts.push(
      { ...part('D', 546, 546), boardId: 'b9', expr: { W: '546', H: '546', D: '9' } },
      { ...part('E', 364, 546), boardId: 'b9', expr: { W: '364', H: '546', D: '9' } },
      { ...part('F', 364, 546), boardId: 'b9', expr: { W: '364', H: '546', D: '9' } },
    )
    const r = run(j)
    const same = run(j, true)
    const old = run(j, false)
    expect(r.materials.map((m) => m.sheetCount)).toEqual([1, 1])
    expect(r.materials[0].sheets).toEqual(old.materials[0].sheets)
    expect(r.materials[1].sheets).toEqual(same.materials[1].sheets)
  })
})

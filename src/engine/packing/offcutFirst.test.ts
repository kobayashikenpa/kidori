// E-78（第2.6版。未決事項 62 の決定）：重ねた板の端材の行は、いつもほかの行より先に使う
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { BETA20, L18, MEL, allStacks, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import type { Job, PackingResult } from '../types'
import { packJob } from './index'
import { stackKey } from './stack'

const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const
const run = (job: Job) => packJob(job, computeDimensions(job))
const rows = (r: PackingResult) => r.materials.map((m) => [m.boardId, m.sheetCount, m.offcutSheetCount])
const sizes = (r: PackingResult, id: string) => r.materials.find((m) => m.boardId === id)!.sheets.map((s) => [s.boardWidth, s.boardLength, !!s.sheet?.offcut])

/**
 * ベタ20（ラワン18×1・メラミン1×2）の 1800×450 の部材 1枚 → 組（メラミン1＋ラワン18）1・メラミン1 の残り 1。
 * メラミン1 は 4×8、ラワン18 は 3×6 なので組の板は 4×8（縦切り優先・端切り 5・刃厚 3）→ 端材 762×2440 と 450×637。
 * 別の部材として ラワン18 を直接選んだ部材 extra を足す
 */
function job(extra: { h: number; d: number }): Job {
  const j = stackJob([groupPart('側板', BETA20, 1800, 450, 1), boardPart('棚', L18, extra.h, extra.d, 1)])
  j.boards = j.boards.map((b) => (b.id === MEL ? { ...b, ...S48 } : b))
  return j
}

describe('端材の行を先に使う', () => {
  it('組 4×8 の端材 762×2440 と材料の行 3×6 の両方に入る 1800×700 は端材に入り、3×6 の新しい板を使わない', () => {
    const j = job({ h: 1800, d: 700 })
    const r = packJob(j, computeDimensions(j), allStacks(j))
    const key = stackKey(MEL, L18)
    expect(rows(r)).toEqual([
      [MEL, 0, 1],
      [key, 1, 0],
      [L18, 0, 1],
    ])
    expect(sizes(r, L18)).toEqual([[762, 2440, true]])
    expect(r.materials.find((m) => m.boardId === L18)!.sheets[0].placements.map((p) => p.name)).toEqual(['棚'])
  })

  it('確かめ（decideStacks）でも組を採る：ラワン18 はオフの 3×6 2枚より少ない（組の1枚だけ）', () => {
    const j = job({ h: 1800, d: 700 })
    const r = run(j)
    expect(r.stacks.accepted.map((p) => p.key)).toEqual([stackKey(MEL, L18)])
    expect(r.stacks.rejected).toEqual([])
    const off = run({ ...j, stacking: 'off' })
    expect(rows(off)).toEqual([
      [MEL, 1, 0],
      [L18, 2, 0],
    ])
  })

  it('端材の中では入る一番小さい行から：400×300 は 450×637 の端材に入る', () => {
    const j = job({ h: 400, d: 300 })
    const r = packJob(j, computeDimensions(j), allStacks(j))
    expect(sizes(r, L18)).toEqual([[450, 637, true]])
  })

  it('どの端材にも入らない片は、ほかの行（3×6）の新しい板', () => {
    const j = job({ h: 1800, d: 800 })
    const r = packJob(j, computeDimensions(j), allStacks(j))
    expect(sizes(r, L18)).toEqual([[910, 1820, false]])
  })

  it('手持ち（自由入力）の小さい行があっても端材が先', () => {
    const j = job({ h: 1800, d: 700 })
    j.boards = j.boards.map((b) =>
      b.id === L18 ? { ...b, stockOn: true, stock: [{ id: 's1', sizeKind: 'custom', width: 750, length: 1850, grain: 'long', count: 1 }] } : b,
    )
    const r = packJob(j, computeDimensions(j), allStacks(j))
    expect(sizes(r, L18)).toEqual([[762, 2440, true]])
  })
})

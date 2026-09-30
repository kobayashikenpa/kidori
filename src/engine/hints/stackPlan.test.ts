// E-76（第2.6版。architecture.md 18.5）：3×6／4×8 の比べ・お知らせ・足りないときを、今の仕事で決まった組のまま計算する
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { withStock } from '../fixtures/stock'
import { BETA20, FLUSH25, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import { packJob } from '../packing'
import { compareStandardSizes } from '../packing/sizes'
import { stackKey } from '../packing/stack'
import { findSavingHints } from './saving'
import { stockShortage } from './shortage'

describe('3×6／4×8 の比べ', () => {
  it('見本：組の行（3×6 5枚・4×8 5枚）・ラワン4 の比べが今の値のまま', () => {
    const job = sampleGroupJob(true)
    const c = compareStandardSizes(job, computeDimensions(job))
    expect(c.map((x) => [x.boardId, x.options.map((o) => o.sheetCount)])).toEqual([
      [stackKey(MELAMINE_1_ID, LAUAN_4_ID), [5, 5]],
      [LAUAN_4_ID, [1, 1]],
    ])
  })

  it('ベタ20 の組がある仕事で、組の行（2枚重ね：メラミン1＋ラワン18）にも比べが出る', () => {
    const job = stackJob([groupPart('側板', BETA20, 1800, 800, 2), boardPart('桟', L18, 1000, 90, 1)])
    const c = compareStandardSizes(job, computeDimensions(job))
    const row = c.find((x) => x.boardId === stackKey(MEL, L18))!
    expect(row.stack).toEqual({ boardIds: [MEL, L18] })
    expect(row.options.map((o) => o.sheetCount)).toEqual([2, 2])
  })

  it('今の仕事で重ねなかった組（rejected）は、比べでも重ねない', () => {
    const job = stackJob([groupPart('天板', FLUSH25, 600, 100, 1), boardPart('棚', L4, 800, 700, 2)])
    job.stackSheets = [{ boardIds: [MEL, L4], sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' }]
    const dims = computeDimensions(job)
    expect(packJob(job, dims).stacks.rejected.map((p) => p.key)).toEqual([stackKey(MEL, L4)])
    expect(compareStandardSizes(job, dims).some((x) => x.stack)).toBe(false)
  })
})

describe('お知らせ・足りないとき', () => {
  it('お知らせは今の仕事で決まった組のまま（組の名前は「2枚重ね：…」）', () => {
    const job = stackJob([groupPart('天板', FLUSH25, 900, 600, 2, 'D')])
    job.parts[0].allowance = null
    const hints = findSavingHints(job)
    for (const h of hints) for (const m of h.materials) if (m.boardId.startsWith('stack:')) expect(m.label.startsWith('2枚重ね：')).toBe(true)
  })

  it('見本のラワン4 を手持ち 600×1200 ×5 にしても、足りないのは背板だけ（組は重ねたまま）', () => {
    const job = withStock(sampleGroupJob(true), LAUAN_4_ID, [{ width: 600, length: 1200, grain: 'long', count: 5 }])
    const [s] = stockShortage(job, computeDimensions(job))
    expect(s.missing).toEqual(['背板'])
  })

  it('部材 150枚で、お知らせ（切り代・端切りを試す）が 1秒以内', () => {
    const parts = []
    for (let i = 0; i < 15; i++) {
      const p = groupPart(`g${i}`, i % 2 ? FLUSH25 : BETA20, 300 + i * 37, 200 + i * 23, 3, 'any')
      p.allowance = null
      parts.push(p)
      parts.push(boardPart(`d${i}`, i % 3 ? L18 : L4, 200 + i * 41, 60 + i * 11, 5, 'any'))
    }
    const job = stackJob(parts)
    const t = performance.now()
    findSavingHints(job)
    expect(performance.now() - t).toBeLessThan(1000)
  }, 20_000)
})

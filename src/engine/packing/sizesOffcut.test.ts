// E-80（第2.6版）：3×6／4×8 の比べに端材から取った1枚の数を足す・重ねなかった組の名前
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { BETA20, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import type { Job } from '../types'
import { compareStandardSizes, pickBetterSize, type SizeSummary } from './sizes'
import { stackKey, stackLabel, stackPairName } from './stack'

const summary = (job: Job) =>
  compareStandardSizes(job, computeDimensions(job)).map((c) => [c.boardId, c.options.map((o) => [o.kind, o.sheetCount, o.offcutSheetCount, o.unplacedCount]), c.fewer])

describe('compareStandardSizes の端材から取った1枚の数', () => {
  it('ラワン18 の 1000×90 は 3×6・4×8 とも 新しい板 0枚・端材から 1枚（組の行は端材を数えない）', () => {
    const job = stackJob([groupPart('側板', BETA20, 1800, 800, 1), boardPart('桟', L18, 1000, 90, 1)])
    expect(summary(job)).toEqual([
      [MEL, [['saburoku', 1, 0, 0], ['shihachi', 1, 0, 0]], null],
      [stackKey(MEL, L18), [['saburoku', 1, 0, 0], ['shihachi', 1, 0, 0]], null],
      [L18, [['saburoku', 0, 1, 0], ['shihachi', 0, 1, 0]], null],
    ])
  })

  const opt = (kind: SizeSummary['kind'], sheetCount: number, offcutSheetCount: number, yieldRate: number): SizeSummary => ({
    kind,
    width: kind === 'saburoku' ? 910 : 1220,
    length: kind === 'saburoku' ? 1820 : 2440,
    sheetCount,
    offcutSheetCount,
    yieldRate,
    unplacedCount: 0,
  })

  it('端材だけで足りるサイズ（0枚・端材から1枚）と 1枚のサイズは、0枚のほうが「枚数が少ない」', () => {
    expect(pickBetterSize([opt('saburoku', 0, 1, 0.5), opt('shihachi', 1, 0, 0.3)])).toEqual({ fewer: 'saburoku', higher: 'saburoku' })
  })

  it('どちらも使う板が無い（0枚・端材も 0）なら比べない', () => {
    expect(pickBetterSize([opt('saburoku', 0, 0, 0), opt('shihachi', 1, 0, 0.3)])).toEqual({ fewer: null, higher: null })
  })
})

describe('stackPairName（重ねなかった組の名前）', () => {
  it('「メラミン1＋ラワン18」', () => {
    expect(stackPairName(stackJob([]), [MEL, L18])).toBe('メラミン1＋ラワン18')
  })

  it('材料が無ければ fallback、それも無ければ id。stackLabel は「2枚重ね：」を付けたもの', () => {
    const job = stackJob([])
    job.boards = job.boards.filter((b) => b.id !== L4)
    expect(stackPairName(job, [MEL, L4])).toBe(`メラミン1＋${L4}`)
    expect(stackPairName(job, [MEL, L4], [{ material: 'メラミン', thickness: 1 }, { material: 'ラワン', thickness: 4 }])).toBe('メラミン1＋ラワン4')
    expect(stackLabel(stackJob([]), [MEL, L4])).toBe('2枚重ね：メラミン1＋ラワン4')
  })
})

// E-75（第2.6版。architecture.md 18.6・18.9）：固定・まとめ・手持ちの一覧（端材の行・端材の1枚）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { BETA20, FLUSH25, L18, L4, MEL, boardPart, groupPart, stackJob } from '../fixtures/stackNew'
import { packJob } from '../packing'
import { stackKey } from '../packing/stack'
import type { Job } from '../types'
import { freezeSheet, frozenDemand, frozenSheetViews, materialSizeCounts, materialSummaries, stockUsage } from './frozen'

const NOW = new Date('2026-09-30T00:00:00.000Z')
const run = (job: Job) => packJob(job, computeDimensions(job))
const KEY = stackKey(MEL, L18)

/** ベタ20 の 1800×800 の部材 1枚と、ラワン18 を直接選んだ 1000×90（ラワン18 は端材から1枚） */
const betaJob = () => stackJob([groupPart('側板', BETA20, 1800, 800, 1), boardPart('桟', L18, 1000, 90, 1)])

function summaries(job: Job) {
  const r = run(job)
  const views = frozenSheetViews(job, computeDimensions(job))
  return { r, views, s: materialSummaries(job, r, views), sizes: materialSizeCounts(job, r, views) }
}

describe('固定した1枚とチェック', () => {
  it('重ねた板の片に1回チェックすると上下の両方に付く（frozenDemand）', () => {
    const job = betaJob()
    const g = run(job).materials.find((m) => m.boardId === KEY)!
    const f = freezeSheet(job, MEL, g.mode, g.sheets[0], 'f1', NOW, L18)
    f.checked = [g.sheets[0].placements[0].pieceId]
    const d = frozenDemand({ frozenSheets: [f] })
    expect([d.get(`側板|${MEL}`), d.get(`側板|${L18}`)]).toEqual([1, 1])
    expect(frozenSheetViews({ ...job, frozenSheets: [f] }, computeDimensions(job))[0].label).toBe('2枚重ね：メラミン1＋ラワン18')
  })

  it('端材の1枚の片のチェックはその材料だけ。写しに sheet.offcut が残る', () => {
    const job = betaJob()
    const m = run(job).materials.find((x) => x.boardId === L18)!
    const f = freezeSheet(job, L18, m.mode, m.sheets[0], 'f1', NOW)
    expect(f.layout.sheet?.offcut).toEqual({ source: 1 })
    expect(f.grain).toBe('long')
    expect([...frozenDemand({ frozenSheets: [f] }).entries()]).toEqual([[`桟|${L18}`, 1]])
  })
})

describe('まとめ（materialSummaries・materialSizeCounts）', () => {
  it('材料の行が「0枚（端材から 1枚）」：sheetCount 0・offcutCount 1、サイズ別の枚数に端材は入らない', () => {
    const { s, sizes } = summaries(betaJob())
    const row = s.materials.find((x) => x.boardId === L18)!
    expect([row.sheetCount, row.offcutCount]).toEqual([0, 1])
    expect(sizes.find((x) => x.boardId === L18)!.bySize).toEqual([])
    expect(s.materials.find((x) => x.boardId === KEY)!.offcutCount).toBe(0)
  })

  it('固定した端材の1枚も枚数に数えない（端材から 1枚）', () => {
    let job = betaJob()
    const m = run(job).materials.find((x) => x.boardId === L18)!
    const f = freezeSheet(job, L18, m.mode, m.sheets[0], 'f1', NOW)
    f.checked = [m.sheets[0].placements[0].pieceId]
    job = { ...job, frozenSheets: [f] }
    const row = summaries(job).s.materials.find((x) => x.boardId === L18)!
    expect([row.sheetCount, row.offcutCount]).toEqual([0, 1])
  })

  it('全体の歩留まりは packJob と同じ（固定が無ければ）', () => {
    const { r, s } = summaries(betaJob())
    expect(s.totalYieldRate).toBeCloseTo(r.totalYieldRate, 10)
  })
})

describe('stockUsage の端材の行', () => {
  it('サイズを選んでいる材料にも端材の行：使った 1／枚数 1、名前は「端材 102×1820（重ねた板1から）」', () => {
    const job = betaJob()
    const u = stockUsage(job, run(job))
    const l18 = u.find((x) => x.boardId === L18)!
    expect(l18.rows).toEqual([])
    expect(l18.offcuts).toEqual([{ stockId: `offcut:${KEY}#1:0`, label: '端材 102×1820（重ねた板1から）', width: 102, length: 1820, source: 1, count: 1, used: 1 }])
    // メラミン1 の行（残りの側板）にも同じ端材の行（側板は入らないので使わない）
    expect(u.find((x) => x.boardId === MEL)!.offcuts.map((o) => [o.label, o.used])).toEqual([['端材 102×1820（重ねた板1から）', 0]])
  })

  it('固定した端材の1枚は使った枚数に数える', () => {
    let job = betaJob()
    const m = run(job).materials.find((x) => x.boardId === L18)!
    job = { ...job, frozenSheets: [freezeSheet(job, L18, m.mode, m.sheets[0], 'f1', NOW)] }
    const o = stockUsage(job, run(job)).find((x) => x.boardId === L18)!.offcuts
    expect(o.map((x) => [x.count, x.used])).toEqual([[1, 1]])
  })

  it('まとめに材料の行が無い材料（組だけで使う）には出さない', () => {
    const job = stackJob([groupPart('側板', FLUSH25, 1800, 800, 1)])
    const u = stockUsage(job, run(job))
    expect(u.find((x) => x.boardId === MEL)).toBeUndefined()
    expect(u.find((x) => x.boardId === L4)).toBeUndefined()
  })

  it('重ねた板を固定したあと部材を足しても、その端材の行は変わらない', () => {
    let job = betaJob()
    const g = run(job).materials.find((m) => m.boardId === KEY)!
    job = { ...job, frozenSheets: [freezeSheet(job, MEL, g.mode, g.sheets[0], 'f1', NOW, L18)] }
    const before = stockUsage(job, run(job)).find((x) => x.boardId === L18)!.offcuts
    expect(before.map((o) => [o.stockId, o.label])).toEqual([['offcut:f1:0', '端材 102×1820（重ねた板1から）']])
    job = { ...job, parts: [...job.parts, groupPart('天板', BETA20, 900, 400, 1)] }
    const after = stockUsage(job, run(job)).find((x) => x.boardId === L18)!.offcuts
    expect(after[0]).toMatchObject({ stockId: 'offcut:f1:0', label: '端材 102×1820（重ねた板1から）', source: 1 })
  })
})

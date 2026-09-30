// E-72（第2.6版。architecture.md 18.4 の 4・6）：重ねた板の端材を手持ちの行にする・端切りをしない行
import { describe, expect, it } from 'vitest'
import { L18, L4, MEL, stackJob } from '../fixtures/stackNew'
import type { FrozenSheet, MaterialResult, Rect, SheetLayout } from '../types'
import { packOnStock, sheetSpecs } from './guillotine'
import { offcutStock, stackSheetNumbers } from './offcuts'
import type { Piece } from './pieces'
import { stackKey } from './stack'
import type { StockKind } from './stock'

function layout(scraps: Rect[], orientation: SheetLayout['orientation'] = 'portrait', index = 1): SheetLayout {
  return {
    index,
    boardWidth: 910,
    boardLength: 1820,
    orientation,
    trims: [],
    usable: { x: 0, y: 0, w: 905, h: 1820 },
    placements: [],
    cuts: [],
    scraps,
    usedArea: 0,
    yieldRate: 0,
  }
}

function stackResult(a: string, b: string, sheets: SheetLayout[]): MaterialResult {
  return {
    boardId: stackKey(a, b),
    material: '',
    thickness: 1,
    mode: 'vertical',
    sheets,
    sheetCount: sheets.length,
    offcutSheetCount: 0,
    yieldRate: 0,
    unplaced: [],
    stack: { boardIds: [a, b] },
  }
}

function frozenStack(id: string, a: string, b: string, l: SheetLayout, completed = false): FrozenSheet {
  const f: FrozenSheet = {
    id,
    boardId: a,
    material: 'x',
    thickness: 1,
    grain: 'long',
    mode: 'vertical',
    kerf: 3,
    trim: 5,
    layout: l,
    checked: [],
    frozenAt: '2026-01-01T00:00:00.000Z',
    stackWith: { boardId: b, material: 'y', thickness: 4 },
  }
  if (completed) f.completedAt = '2026-01-02T00:00:00.000Z'
  return f
}

describe('stackSheetNumbers（重ねた板の番号）', () => {
  it('組の並び → 組ごとに 固定した1枚（切り終わりを含む。固定した順）→ 計算した1枚', () => {
    const job = stackJob([])
    job.frozenSheets = [
      frozenStack('f2', MEL, L18, layout([])),
      frozenStack('f1', MEL, L4, layout([]), true),
      frozenStack('f3', MEL, L4, layout([])),
    ]
    const materials = [stackResult(MEL, L4, [layout([], 'portrait', 1), layout([], 'portrait', 2)]), stackResult(MEL, L18, [layout([])])]
    const n = stackSheetNumbers(job, materials)
    expect(n.map((s) => [s.number, s.id])).toEqual([
      [1, 'f1'],
      [2, 'f3'],
      [3, `${stackKey(MEL, L4)}#1`],
      [4, `${stackKey(MEL, L4)}#2`],
      [5, 'f2'],
      [6, `${stackKey(MEL, L18)}#1`],
    ])
    expect(n[0].frozen?.id).toBe('f1')
    expect(n[2].frozen).toBeUndefined()
  })
})

describe('offcutStock（重ねた板の端材 → a・b の手持ちの行）', () => {
  it('縦長の 3×6 に 102×1820 の端材 → a・b に1行ずつ（木目 長手・端切りなし・1枚）', () => {
    const job = stackJob([])
    const rows = offcutStock(stackSheetNumbers(job, [stackResult(MEL, L4, [layout([{ x: 0, y: 0, w: 102, h: 1820 }])])]))
    const want: StockKind = {
      stockId: `offcut:${stackKey(MEL, L4)}#1:0`,
      sizeKind: 'custom',
      width: 102,
      length: 1820,
      grain: 'long',
      count: 1,
      noTrim: true,
      offcut: { source: 1 },
    }
    expect(rows.get(MEL)).toEqual([want])
    expect(rows.get(L4)).toEqual([want])
  })

  it('横長の端材の木目：長辺が板の長手方向なら long、そうでなければ short', () => {
    const job = stackJob([])
    const l = layout(
      [
        { x: 0, y: 0, w: 1815, h: 102 },
        { x: 0, y: 200, w: 100, h: 500 },
      ],
      'landscape',
    )
    const rows = offcutStock(stackSheetNumbers(job, [stackResult(MEL, L4, [l])]))
    expect(rows.get(MEL)!.map((r) => [r.width, r.length, r.grain])).toEqual([
      [102, 1815, 'long'],
      [100, 500, 'short'],
    ])
  })

  it('縦長で、長辺が妻手方向の端材は short', () => {
    const job = stackJob([])
    const rows = offcutStock(stackSheetNumbers(job, [stackResult(MEL, L4, [layout([{ x: 0, y: 0, w: 800, h: 300 }])])]))
    expect(rows.get(MEL)!.map((r) => [r.width, r.length, r.grain])).toEqual([[300, 800, 'short']])
  })

  it('30mm 未満の端材は行にしない（ぴったり 30 は行にする）', () => {
    const job = stackJob([])
    const l = layout([
      { x: 0, y: 0, w: 29.9, h: 1820 },
      { x: 100, y: 0, w: 30, h: 500 },
    ])
    const rows = offcutStock(stackSheetNumbers(job, [stackResult(MEL, L4, [l])]))
    expect(rows.get(MEL)!.map((r) => [r.width, r.length])).toEqual([[30, 500]])
  })

  it('固定した重ねた板（切り終わりを含む）からも行ができる。番号は固定した板の番号', () => {
    const job = stackJob([])
    job.frozenSheets = [frozenStack('f1', MEL, L4, layout([{ x: 0, y: 0, w: 102, h: 1820 }]), true)]
    const rows = offcutStock(stackSheetNumbers(job, []))
    expect(rows.get(L4)).toEqual([
      { stockId: 'offcut:f1:0', sizeKind: 'custom', width: 102, length: 1820, grain: 'long', count: 1, noTrim: true, offcut: { source: 1 } },
    ])
  })

  it('固定した板の木目が短手なら、長辺が長手方向の端材は short', () => {
    const job = stackJob([])
    const f = frozenStack('f1', MEL, L4, layout([{ x: 0, y: 0, w: 102, h: 1820 }]))
    f.grain = 'short'
    job.frozenSheets = [f]
    expect(offcutStock(stackSheetNumbers(job, [])).get(MEL)![0].grain).toBe('short')
  })
})

describe('端切りをしない行（noTrim）', () => {
  const piece: Piece = {
    pieceId: 'p#1',
    partId: 'p',
    name: 'p',
    sizeLabel: '1000×90',
    orientations: [],
    shape: { s0: 1000, s1: 90, grain: 0 },
  }
  const row: StockKind = { stockId: 'o', sizeKind: 'custom', width: 102, length: 1820, grain: 'long', count: 1, noTrim: true }

  it('使える範囲は端材の大きさそのもの（縦切り優先・横切り優先とも）', () => {
    expect(sheetSpecs([row], 5, 'vertical')[0].usable).toEqual({ x: 0, y: 0, w: 102, h: 1820 })
    expect(sheetSpecs([row], 5, 'horizontal')[0].usable).toEqual({ x: 0, y: 0, w: 1820, h: 102 })
    // 端切りをする行は今のまま
    const { noTrim: _n, ...plain } = row
    expect(sheetSpecs([plain], 5, 'vertical')[0].usable).toEqual({ x: 0, y: 0, w: 97, h: 1820 })
  })

  it('幅ぴったり 102 の片も端材に入る（端切りがあれば入らない）', () => {
    const wide = { ...piece, shape: { s0: 1000, s1: 102, grain: 0 as const } }
    expect(packOnStock([wide], [row], 5, 3, 'vertical').unplaced).toEqual([])
    const { noTrim: _n, ...plain } = row
    expect(packOnStock([wide], [plain], 5, 3, 'vertical').unplaced.length).toBe(1)
  })
})

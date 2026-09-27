import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { packJob } from '../packing'
import { buildCuts } from '../packing/cutOrder'
import { packGuillotine } from '../packing/guillotine'
import type { Piece } from '../packing/pieces'
import { sheetOrientation, trimRects, usableRect } from '../packing/sheet'
import type { Job, Placement, SheetLayout } from '../types'
import { sheetChecklist } from './sheetChecklist'
import { pieceReleaseSteps } from './sheetProgress'

const sheetsOf = (job: Job) => packJob(job, computeDimensions(job)).materials.find((m) => m.boardId === LUMBER_18_ID)!.sheets

const BOARD = { id: 'b', material: 'シナランバー', thickness: 18, sizeKind: 'saburoku' as const, width: 910, length: 1820, grain: 'long' as const }

/** 片から1枚の配置（packJob と同じ組み立て）を作る */
function layoutOf(pieces: Piece[], mode: 'vertical' | 'horizontal' = 'vertical', trim = 5, kerf = 3): SheetLayout {
  const usable = usableRect(BOARD, trim, mode)
  const g = packGuillotine(pieces, usable, kerf, mode)
  const sh = g.sheets[0]
  const placements: Placement[] = sh.strips.flatMap((s) => s.items.map((it) => it.placement))
  return {
    index: 1,
    boardWidth: BOARD.width,
    boardLength: BOARD.length,
    orientation: sheetOrientation(mode),
    trims: trimRects(BOARD, trim, mode),
    usable,
    placements,
    cuts: buildCuts(sh, g.frame, BOARD, trim),
    scraps: [],
    usedArea: 0,
    yieldRate: 0,
  }
}

/** x：短辺方向、y：長辺方向。rotatable なら 90° 回した向きも置ける */
function piece(id: string, x: number, y: number, rotatable = false): Piece {
  const orientations = [{ x, y, rotated: false }]
  if (rotatable) orientations.push({ x: y, y: x, rotated: true })
  return { pieceId: `${id}#1`, partId: id, name: id, sizeLabel: `${y}×${x}`, orientations }
}

describe('sheetChecklist の並び（切る順番に取り出される順）', () => {
  it('見本（本棚 W900）の2枚目：天地板（右の帯・上 → 下）→ 棚板（次の帯・上 → 下）', () => {
    const job = bookshelfJob()
    const [, second] = sheetsOf(job)
    const rows = sheetChecklist(job, second, [])
    expect(rows.map((r) => r.name)).toEqual(['天地板', '天地板', '棚板', '棚板'])
    const steps = pieceReleaseSteps(second)
    expect(rows.map((r) => steps.get(r.pieceId))).toEqual([3, 4, 6, 7])
  })

  it('見本（本棚 W900）のすべての1枚・両方の切り方で、行は取り出す工程の小さい順', () => {
    for (const mode of ['vertical', 'horizontal'] as const) {
      const job = bookshelfJob()
      job.settings = { ...job.settings, cutMode: mode }
      for (const m of packJob(job, computeDimensions(job)).materials) {
        for (const s of m.sheets) {
          const steps = pieceReleaseSteps(s)
          const got = sheetChecklist(job, s, []).map((r) => steps.get(r.pieceId)!)
          expect(got).toEqual([...got].sort((a, b) => a - b))
          expect(got).toHaveLength(s.placements.length)
        }
      }
    }
  })

  it('帯より細い片は、幅を切り揃える工程（帯の最後）で取り出されるので、あとから置いた帯いっぱいの片より後に並ぶ', () => {
    // 帯 400：A 400×1000 → B 300×600（細い）→ C は残り 217 に 400×150 で寝かせて入る
    const l = layoutOf([piece('A', 400, 1000), piece('B', 300, 600), piece('C', 150, 400, true)])
    expect(l.placements.map((p) => p.name)).toEqual(['A', 'B', 'C'])
    expect(l.cuts.map((c) => c.kind)).toEqual(['trim', 'strip', 'crosscut', 'crosscut', 'crosscut', 'rip'])
    expect(sheetChecklist(bookshelfJob(), l, []).map((r) => r.name)).toEqual(['A', 'C', 'B'])
  })

  it('同じ工程で取り出される片（最後の切り分けの上と下）は、配置の順（上が先）', () => {
    // 帯の長さ 1820 に 900 + 3 + 917 がぴったり：最後の切り分け1本で両方が取り出される
    const l = layoutOf([piece('上', 400, 917), piece('下', 400, 900)])
    const steps = pieceReleaseSteps(l)
    expect(steps.get('上#1')).toBe(steps.get('下#1'))
    expect(sheetChecklist(bookshelfJob(), l, []).map((r) => r.name)).toEqual(['上', '下'])
  })

  it('横切り優先でも同じ（細い片は後）', () => {
    const l = layoutOf([piece('A', 400, 1000), piece('B', 300, 600), piece('C', 150, 400, true)], 'horizontal')
    const names = sheetChecklist(bookshelfJob(), l, []).map((r) => r.name)
    const steps = pieceReleaseSteps(l)
    const got = l.placements.map((p) => p.pieceId).sort((a, b) => steps.get(a)! - steps.get(b)!)
    expect(names).toEqual(got.map((id) => l.placements.find((p) => p.pieceId === id)!.name))
  })
})

describe('sheetChecklist（1枚ごとのチェックリスト）', () => {
  it('1片1行（見本の2枚目は placements と同じ並び）。チェックした行だけ done', () => {
    const job = bookshelfJob()
    const [, second] = sheetsOf(job)
    const rows = sheetChecklist(job, second, [second.placements[1].pieceId])
    expect(rows.map((r) => [r.pieceId, r.name, r.sizeLabel, r.done])).toEqual(
      second.placements.map((p, i) => [p.pieceId, p.name, p.sizeLabel, i === 1]),
    )
    expect(rows.every((r) => r.partId === second.placements.find((p) => p.pieceId === r.pieceId)!.partId)).toBe(true)
  })

  it('部材名を変えると行の名前もついてくる。部材を消すと写しの名前', () => {
    const job = bookshelfJob()
    const [first] = sheetsOf(job)
    const renamed = { ...job, parts: job.parts.map((p) => (p.name === '側板' ? { ...p, name: '側板L' } : p)) }
    expect(sheetChecklist(renamed, first, []).map((r) => r.name)).toEqual(['側板L', '側板L'])
    const removed = { ...job, parts: job.parts.filter((p) => p.name !== '側板') }
    expect(sheetChecklist(removed, first, []).map((r) => r.name)).toEqual(['側板', '側板'])
  })

  it('寸法は写し（計算の結果）のまま。今の寸法が変わっても変わらない', () => {
    const job = bookshelfJob()
    const [first] = sheetsOf(job)
    const changed = { ...job, parts: job.parts.map((p) => (p.name === '全体' ? { ...p, expr: { ...p.expr, H: '1500' } } : p)) }
    expect(sheetChecklist(changed, first, []).map((r) => r.sizeLabel)).toEqual(['1810×410', '1810×410'])
  })
})

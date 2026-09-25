import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { CutStep, Job, Placement, Rect } from '../types'
import { buildCuts } from './cutOrder'
import { packGuillotine, type StripMode } from './guillotine'
import { expandPieces, type Piece } from './pieces'
import { usableRect } from './sheet'

const BOARD = { width: 910, length: 1820 }

function cutsOf(job: Job, boardId: string, mode: StripMode) {
  const g = expandPieces(job, computeDimensions(job)).groups.find((x) => x.board.id === boardId)!
  const r = packGuillotine(g.pieces, usableRect(g.board, job.settings.trim), job.settings.kerf, mode)
  return r.sheets.map((sh) => ({
    cuts: buildCuts(sh, r.frame, g.board, job.settings.trim),
    placements: sh.strips.flatMap((s) => s.items.map((i) => i.placement)),
  }))
}

const same = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6

/**
 * 板全体から始めて、切る順番どおりに長方形を2つに分けていく。
 * どの切断も「今ある長方形の1つ」を端から端まで一直線に切ること（ギロチン）を確かめ、
 * 最後に残った長方形の中に、配置した片がそのままの形で1つずつあることを確かめる。
 * 刃厚は、測った側（右端・上端・下端から◯mm の◯mm の側）の反対側で消える。
 * 縦に切るときは線の左、「上端から」の横の切断は線の下、「下端から」の横の切断は線の上（耳落としは刃厚を含む）
 */
function expectGuillotine(cuts: CutStep[], placements: Placement[], board: { width: number; length: number }, kerf: number) {
  let rects: Rect[] = [{ x: 0, y: 0, w: board.width, h: board.length }]
  cuts.forEach((c, i) => {
    expect(c.no).toBe(i + 1)
    const idx = rects.findIndex((r) => same(r, c.within))
    expect(idx, `切断 ${c.no} の範囲が、その時点の長方形のどれとも一致しない`).toBeGreaterThanOrEqual(0)
    const r = rects[idx]
    const next: Rect[] = []
    if (c.direction === 'vertical') {
      expect(c.at).toBeGreaterThan(r.x)
      expect(c.at).toBeLessThan(r.x + r.w)
      next.push({ x: c.at, y: r.y, w: r.x + r.w - c.at, h: r.h })
      const leftEnd = c.kind === 'trim' ? c.at : c.at - kerf
      if (leftEnd > r.x) next.push({ x: r.x, y: r.y, w: leftEnd - r.x, h: r.h })
    } else {
      expect(c.at).toBeGreaterThan(r.y)
      expect(c.at).toBeLessThan(r.y + r.h)
      if (c.label.startsWith('上端から')) {
        // 上側（線より上）が測った側。刃厚は線の下で消える
        next.push({ x: r.x, y: c.at, w: r.w, h: r.y + r.h - c.at })
        const downEnd = c.at - kerf
        if (downEnd > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: downEnd - r.y })
      } else {
        expect(c.label.startsWith('下端から')).toBe(true)
        next.push({ x: r.x, y: r.y, w: r.w, h: c.at - r.y })
        const upStart = c.at + kerf
        if (upStart < r.y + r.h) next.push({ x: r.x, y: upStart, w: r.w, h: r.y + r.h - upStart })
      }
    }
    rects = [...rects.slice(0, idx), ...next, ...rects.slice(idx + 1)]
  })
  for (const p of placements) {
    expect(rects.filter((r) => same(r, p)), `${p.pieceId} が切り出されていない`).toHaveLength(1)
  }
}

function piece(id: string, x: number, y: number): Piece {
  return { pieceId: `${id}#1`, partId: id, name: id, sizeLabel: `${y}×${x}`, orientations: [{ x, y, rotated: false }] }
}

describe('buildCuts（切る順番）', () => {
  it('見本・縦切り優先の1枚目：耳落とし → 右端から410mmの縦 → 側板を切り分け → 次の帯', () => {
    const [s1] = cutsOf(bookshelfJob(), LUMBER_18_ID, 'vertical')
    expect(s1.cuts.map((c) => [c.no, c.kind, c.direction, c.at, c.label])).toEqual([
      [1, 'trim', 'vertical', 905, '耳落とし：右の長辺を 5mm 落とす（縦に切る）'],
      [2, 'strip', 'vertical', 495, '右端から 410mm で縦に切る'],
      [3, 'crosscut', 'horizontal', 10, '上端から 1810mm で横に切る'],
      [4, 'strip', 'vertical', 82, '右端から 410mm で縦に切る'],
      [5, 'crosscut', 'horizontal', 10, '上端から 1810mm で横に切る'],
    ])
    expect(s1.cuts[0].within).toEqual({ x: 0, y: 0, w: 910, h: 1820 })
    expect(s1.cuts[1].within).toEqual({ x: 0, y: 0, w: 905, h: 1820 })
    expect(s1.cuts[2].within).toEqual({ x: 495, y: 0, w: 410, h: 1820 })
    expect(s1.cuts[3].within).toEqual({ x: 0, y: 0, w: 492, h: 1820 })
  })

  it('見本・縦切り優先の2枚目：帯の中は上（奥）から、残りの上端から片の長さずつ横に切る', () => {
    const s2 = cutsOf(bookshelfJob(), LUMBER_18_ID, 'vertical')[1]
    expect(s2.cuts.map((c) => [c.kind, c.at, c.label])).toEqual([
      ['trim', 905, '耳落とし：右の長辺を 5mm 落とす（縦に切る）'],
      ['strip', 495, '右端から 410mm で縦に切る'],
      ['crosscut', 946, '上端から 874mm で横に切る'],
      ['crosscut', 69, '上端から 874mm で横に切る'],
      ['strip', 102, '右端から 390mm で縦に切る'],
      ['crosscut', 947, '上端から 873mm で横に切る'],
      ['crosscut', 71, '上端から 873mm で横に切る'],
    ])
  })

  it('見本のすべての板・両方の切り方で、切断がギロチン（端から端まで一直線）で、片がすべて切り出せる', () => {
    for (const mode of ['vertical', 'horizontal'] as const) {
      for (const id of [LUMBER_18_ID, VENEER_4_ID]) {
        for (const s of cutsOf(bookshelfJob(), id, mode)) expectGuillotine(s.cuts, s.placements, BOARD, 3)
      }
    }
  })

  it('見本・横切り優先の1枚目：耳落とし → 下端から1810mmの横 → 右から側板を縦に切り分け', () => {
    const [s1] = cutsOf(bookshelfJob(), LUMBER_18_ID, 'horizontal')
    expect(s1.cuts.map((c) => [c.kind, c.direction, c.at, c.label])).toEqual([
      ['trim', 'vertical', 905, '耳落とし：右の長辺を 5mm 落とす（縦に切る）'],
      ['strip', 'horizontal', 1810, '下端から 1810mm で横に切る'],
      ['crosscut', 'vertical', 495, '右端から 410mm で縦に切る'],
      ['crosscut', 'vertical', 82, '右端から 410mm で縦に切る'],
    ])
  })

  it('板の端にぴったり届く帯・片には切断を入れない', () => {
    // 幅 905・長さ 1820 の片1枚：耳落としだけ
    const usable = { x: 0, y: 0, w: 905, h: 1820 }
    const r = packGuillotine([piece('full', 905, 1820)], usable, 3, 'vertical')
    const cuts = buildCuts(r.sheets[0], r.frame, BOARD, 5)
    expect(cuts.map((c) => c.kind)).toEqual(['trim'])
  })

  it('耳落とし0 なら耳落としの切断はない', () => {
    const usable = { x: 0, y: 0, w: 910, h: 1820 }
    const r = packGuillotine([piece('a', 400, 1000)], usable, 3, 'vertical')
    const cuts = buildCuts(r.sheets[0], r.frame, BOARD, 0)
    expect(cuts.map((c) => [c.no, c.kind, c.at])).toEqual([
      [1, 'strip', 510],
      [2, 'crosscut', 820],
    ])
    expectGuillotine(cuts, r.sheets[0].strips[0].items.map((i) => i.placement), BOARD, 3)
  })

  it('帯より細い片は、切り分けたあとに幅を切り揃える', () => {
    const usable = { x: 0, y: 0, w: 905, h: 1820 }
    const r = packGuillotine([piece('wide', 400, 1000), piece('narrow', 300, 800)], usable, 3, 'vertical')
    const cuts = buildCuts(r.sheets[0], r.frame, BOARD, 5)
    expect(cuts.map((c) => [c.kind, c.direction, c.at, c.label])).toEqual([
      ['trim', 'vertical', 905, '耳落とし：右の長辺を 5mm 落とす（縦に切る）'],
      ['strip', 'vertical', 505, '右端から 400mm で縦に切る'],
      ['crosscut', 'horizontal', 820, '上端から 1000mm で横に切る'],
      ['crosscut', 'horizontal', 17, '上端から 800mm で横に切る'],
      ['rip', 'vertical', 605, '右端から 300mm で縦に切る'],
    ])
    expect(cuts[3].within).toEqual({ x: 505, y: 0, w: 400, h: 817 })
    expect(cuts[4].within).toEqual({ x: 505, y: 17, w: 400, h: 800 })
    expectGuillotine(cuts, r.sheets[0].strips[0].items.map((i) => i.placement), BOARD, 3)
  })

  it('横切り優先で帯より低い片は、横に切って高さを切り揃える', () => {
    const usable = { x: 0, y: 0, w: 905, h: 1820 }
    const r = packGuillotine([piece('tall', 400, 500), piece('low', 300, 200)], usable, 3, 'horizontal')
    const cuts = buildCuts(r.sheets[0], r.frame, BOARD, 5)
    expect(cuts.at(-1)).toMatchObject({ kind: 'rip', direction: 'horizontal', at: 200, label: '下端から 200mm で横に切る' })
    expectGuillotine(cuts, r.sheets[0].strips[0].items.map((i) => i.placement), BOARD, 3)
  })

  it('たくさんの片でも、どの切断もギロチンで片がすべて切り出せる', () => {
    const ps: Piece[] = []
    for (let i = 0; i < 150; i++) ps.push(piece(`p${i}`, 100 + ((i * 37) % 400), 150 + ((i * 53) % 900)))
    const usable = { x: 0, y: 0, w: 905, h: 1820 }
    for (const mode of ['vertical', 'horizontal'] as const) {
      const r = packGuillotine(ps, usable, 3, mode)
      for (const sh of r.sheets) {
        expectGuillotine(buildCuts(sh, r.frame, BOARD, 5), sh.strips.flatMap((s) => s.items.map((i) => i.placement)), BOARD, 3)
      }
    }
  })
})

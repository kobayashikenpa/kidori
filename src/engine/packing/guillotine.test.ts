import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { Job, Placement, Rect } from '../types'
import { packGuillotine, type GuillotineResult } from './guillotine'
import { expandPieces, type Piece } from './pieces'
import { usableRect } from './sheet'

const KERF = 3

function packBoard(job: Job, boardId: string, mode: 'vertical' | 'horizontal'): GuillotineResult {
  const g = expandPieces(job, computeDimensions(job)).groups.find((x) => x.board.id === boardId)!
  return packGuillotine(g.pieces, usableRect(g.board, job.settings.trim, mode), job.settings.kerf, mode)
}

function placements(r: GuillotineResult, sheet: number): Placement[] {
  return r.sheets[sheet].strips.flatMap((s) => s.items.map((i) => i.placement))
}

function names(r: GuillotineResult): string[][] {
  return r.sheets.map((_, i) =>
    placements(r, i)
      .map((p) => p.name)
      .sort(),
  )
}

const rect = (p: Rect) => ({ x: p.x, y: p.y, w: p.w, h: p.h })

/** 範囲内・重ならない・隣り合う片の間が刃厚以上あく */
function expectValid(r: GuillotineResult, usable: Rect, kerf: number) {
  for (let s = 0; s < r.sheets.length; s++) {
    const ps = placements(r, s)
    for (const p of ps) {
      expect(p.x).toBeGreaterThanOrEqual(usable.x)
      expect(p.y).toBeGreaterThanOrEqual(usable.y)
      expect(p.x + p.w).toBeLessThanOrEqual(usable.x + usable.w + 1e-9)
      expect(p.y + p.h).toBeLessThanOrEqual(usable.y + usable.h + 1e-9)
    }
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const b = ps[j]
        const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
        const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(kerf - 1e-9)
      }
    }
    // 帯の中の片は帯の中にある
    for (const st of r.sheets[s].strips) {
      for (const it of st.items) {
        const p = it.placement
        expect(p.x).toBeGreaterThanOrEqual(st.rect.x)
        expect(p.y).toBeGreaterThanOrEqual(st.rect.y)
        expect(p.x + p.w).toBeLessThanOrEqual(st.rect.x + st.rect.w + 1e-9)
        expect(p.y + p.h).toBeLessThanOrEqual(st.rect.y + st.rect.h + 1e-9)
      }
    }
  }
}

function piece(id: string, x: number, y: number, any = false): Piece {
  const orientations = [{ x, y, rotated: false }]
  if (any && x !== y) orientations.push({ x: y, y: x, rotated: true })
  return { pieceId: `${id}#1`, partId: id, name: id, sizeLabel: `${y}×${x}`, orientations }
}

const SABUROKU_USABLE: Rect = { x: 0, y: 0, w: 905, h: 1820 }

describe('packGuillotine 縦切り優先（右から帯詰め、帯の中は上から）', () => {
  it('見本：シナランバー18 は3枚（1枚目 側板×2、2枚目 天地板×2＋棚板×2、3枚目 棚板×2）', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'vertical')
    expect(r.sheets).toHaveLength(3)
    expect(names(r)).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板'],
      ['棚板', '棚板'],
    ])
  })

  it('見本：シナベニヤ4 は1枚。背板は右上（x=5〜905、y=20〜1820）に置く', () => {
    const r = packBoard(bookshelfJob(), VENEER_4_ID, 'vertical')
    expect(r.sheets).toHaveLength(1)
    expect(rect(placements(r, 0)[0])).toEqual({ x: 5, y: 20, w: 900, h: 1800 })
  })

  it('1枚目：最初の側板は右上（右端 x=905、上端 y=1820）、次の帯はその左に刃厚3をあける', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'vertical')
    const ps = placements(r, 0)
    expect(rect(ps[0])).toEqual({ x: 495, y: 10, w: 410, h: 1810 })
    expect(rect(ps[1])).toEqual({ x: 82, y: 10, w: 410, h: 1810 })
    expect(r.sheets[0].strips.map((s) => rect(s.rect))).toEqual([
      { x: 495, y: 0, w: 410, h: 1820 },
      { x: 82, y: 0, w: 410, h: 1820 },
    ])
  })

  it('2枚目：帯の中は上（奥、y=1820）から刃厚をあけて下へ詰める。細い棚板は次の帯', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'vertical')
    expect(placements(r, 1).map((p) => [p.name, rect(p)])).toEqual([
      ['天地板', { x: 495, y: 946, w: 410, h: 874 }],
      ['天地板', { x: 495, y: 69, w: 410, h: 874 }],
      ['棚板', { x: 102, y: 947, w: 390, h: 873 }],
      ['棚板', { x: 102, y: 71, w: 390, h: 873 }],
    ])
    expect(placements(r, 2).map((p) => rect(p))).toEqual([
      { x: 515, y: 947, w: 390, h: 873 },
      { x: 515, y: 71, w: 390, h: 873 },
    ])
  })

  it('配置に部材の情報（片の id・回転・寸法の表記）が付く', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'vertical')
    const p = placements(r, 0)[0]
    expect(p).toMatchObject({ pieceId: 'part-gawaita#1', partId: 'part-gawaita', name: '側板', rotated: false })
    expect(p.sizeLabel).toBe('1810×410')
  })

  it('見本のすべての片が範囲内・重ならない・間が刃厚以上', () => {
    expectValid(packBoard(bookshelfJob(), LUMBER_18_ID, 'vertical'), SABUROKU_USABLE, KERF)
    expectValid(packBoard(bookshelfJob(), VENEER_4_ID, 'vertical'), SABUROKU_USABLE, KERF)
  })

  it('帯の幅：410 + 3 + 410 + 3 + 79 はぴったり入る（3本目の帯 79 が x=0 に届く）', () => {
    const r = packGuillotine([piece('a', 410, 1820), piece('b', 410, 1820), piece('c', 79, 1820)], SABUROKU_USABLE, 3, 'vertical')
    expect(r.sheets).toHaveLength(1)
    expect(placements(r, 0).map((p) => p.x)).toEqual([495, 82, 0])
  })

  it('帯の中の片は上端 y=1820 から詰め、最後の片が下端 y=0 にぴったり届く（908.5 + 3 + 908.5）', () => {
    const r = packGuillotine([piece('a', 300, 908.5), piece('b', 300, 908.5)], SABUROKU_USABLE, 3, 'vertical')
    expect(placements(r, 0).map((p) => [p.y, p.y + p.h])).toEqual([
      [911.5, 1820],
      [0, 908.5],
    ])
  })

  it('帯の幅が1mm 足りないと次の板に回る（80 は入らない）', () => {
    const r = packGuillotine([piece('a', 410, 1820), piece('b', 410, 1820), piece('c', 80, 1820)], SABUROKU_USABLE, 3, 'vertical')
    expect(r.sheets).toHaveLength(2)
  })

  it('帯の長さ：1820 に 908.5 + 3 + 908.5 は入り、909 + 3 + 909 は入らない', () => {
    const fit = packGuillotine([piece('a', 300, 908.5), piece('b', 300, 908.5)], SABUROKU_USABLE, 3, 'vertical')
    expect(fit.sheets[0].strips).toHaveLength(1)
    const over = packGuillotine([piece('a', 300, 909), piece('b', 300, 909)], SABUROKU_USABLE, 3, 'vertical')
    expect(over.sheets[0].strips).toHaveLength(2)
  })

  it('刃厚ぶん入らない：1820 に 910 + 910 は、刃厚3があるので同じ帯に入らない', () => {
    const r = packGuillotine([piece('a', 300, 910), piece('b', 300, 910)], SABUROKU_USABLE, 3, 'vertical')
    expect(r.sheets[0].strips).toHaveLength(2)
    const r0 = packGuillotine([piece('a', 300, 910), piece('b', 300, 910)], SABUROKU_USABLE, 0, 'vertical')
    expect(r0.sheets[0].strips).toHaveLength(1)
  })

  it('帯より細い片は帯の右端に寄せ、前の片の下に刃厚をあけて置く', () => {
    const r = packGuillotine([piece('wide', 400, 1000), piece('narrow', 300, 800)], SABUROKU_USABLE, 3, 'vertical')
    expect(r.sheets[0].strips).toHaveLength(1)
    expect(rect(placements(r, 0)[1])).toEqual({ x: 605, y: 17, w: 300, h: 800 })
  })

  it('前の板の帯に空きがあれば、そこに戻して入れる（First Fit）', () => {
    // 1枚目：900幅の帯（長さ 1500）→ 2枚目：900幅の帯 → 小さい片は1枚目の帯の残り（1820−1500−3=317）に入る
    const r = packGuillotine(
      [piece('a', 900, 1500), piece('b', 900, 1500), piece('small', 200, 300)],
      SABUROKU_USABLE,
      3,
      'vertical',
    )
    expect(r.sheets).toHaveLength(2)
    expect(placements(r, 0).map((p) => p.name)).toEqual(['a', 'small'])
  })

  it('「どちらでもよい」は入る向きに回して詰める', () => {
    // 900幅の帯（長さ 1500）の残り 317 に、300×850 の片を横に倒して入れる
    const r = packGuillotine([piece('a', 900, 1500), piece('any', 300, 850, true)], SABUROKU_USABLE, 3, 'vertical')
    expect(r.sheets).toHaveLength(1)
    const p = placements(r, 0)[1]
    expect(rect(p)).toEqual({ x: 55, y: 17, w: 850, h: 300 })
    expect(p.rotated).toBe(true)
  })

  it('使える範囲に入らない片は板を出さずに unplaced に返す', () => {
    const r = packGuillotine([piece('big', 1000, 300)], SABUROKU_USABLE, 3, 'vertical')
    expect(r.sheets).toEqual([])
    expect(r.unplaced.map((p) => p.partId)).toEqual(['big'])
  })

  it('片がなければ板は0枚', () => {
    expect(packGuillotine([], SABUROKU_USABLE, 3, 'vertical').sheets).toEqual([])
  })

  it('150枚でも範囲内・重ならない・刃厚あき、すぐ終わる', () => {
    const ps: Piece[] = []
    for (let i = 0; i < 150; i++) ps.push(piece(`p${i}`, 100 + ((i * 37) % 400), 150 + ((i * 53) % 900), i % 3 === 0))
    const t = performance.now()
    const r = packGuillotine(ps, SABUROKU_USABLE, 3, 'vertical')
    expect(performance.now() - t).toBeLessThan(200)
    expect(r.sheets.flatMap((_, i) => placements(r, i))).toHaveLength(150)
    expectValid(r, SABUROKU_USABLE, 3)
  })
})

/** 横長に置いたサブロク（端切り5）：x は長手方向 0〜1815、y は妻手方向 0〜905 */
const LANDSCAPE_USABLE: Rect = { x: 0, y: 0, w: 1815, h: 905 }

describe('packGuillotine 横切り優先（横長に置き、右から妻手の幅いっぱいの帯、帯の中は上から）', () => {
  it('見本：シナランバー18 は3枚（1枚目 側板×2、2枚目 天地板×2＋棚板×2、3枚目 棚板×2）、シナベニヤ4 は1枚', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'horizontal')
    expect(names(r)).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '棚板', '棚板'],
      ['棚板', '棚板'],
    ])
    expect(packBoard(bookshelfJob(), VENEER_4_ID, 'horizontal').sheets).toHaveLength(1)
  })

  it('1枚目：帯は右端 x=1815 に接し、妻手の高さいっぱい（y 0〜905）。側板は長手方向に寝かせ、上端 y=905 から下へ詰める', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'horizontal')
    expect(r.sheets[0].strips.map((s) => rect(s.rect))).toEqual([{ x: 5, y: 0, w: 1810, h: 905 }])
    expect(placements(r, 0).map((p) => rect(p))).toEqual([
      { x: 5, y: 495, w: 1810, h: 410 },
      { x: 5, y: 82, w: 1810, h: 410 },
    ])
  })

  it('2枚目・3枚目：帯は右から左へ刃厚3をあけて並ぶ。余りは左に残る', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'horizontal')
    expect(r.sheets[1].strips.map((s) => rect(s.rect))).toEqual([
      { x: 941, y: 0, w: 874, h: 905 },
      { x: 65, y: 0, w: 873, h: 905 },
    ])
    expect(placements(r, 1).map((p) => [p.name, rect(p)])).toEqual([
      ['天地板', { x: 941, y: 495, w: 874, h: 410 }],
      ['天地板', { x: 941, y: 82, w: 874, h: 410 }],
      ['棚板', { x: 65, y: 515, w: 873, h: 390 }],
      ['棚板', { x: 65, y: 122, w: 873, h: 390 }],
    ])
    expect(placements(r, 2).map((p) => rect(p))).toEqual([
      { x: 942, y: 515, w: 873, h: 390 },
      { x: 942, y: 122, w: 873, h: 390 },
    ])
  })

  it('見本のベニヤ：背板（木目H＝長手方向）は右上 x 15〜1815・y 5〜905', () => {
    const r = packBoard(bookshelfJob(), VENEER_4_ID, 'horizontal')
    expect(rect(placements(r, 0)[0])).toEqual({ x: 15, y: 5, w: 1800, h: 900 })
  })

  it('木目：板の木目（長手方向）に合わせた向きは回転なし（rotated=false）のまま', () => {
    const r = packBoard(bookshelfJob(), LUMBER_18_ID, 'horizontal')
    expect(placements(r, 0)[0]).toMatchObject({ name: '側板', rotated: false, sizeLabel: '1810×410' })
  })

  it('見本のすべての片が範囲内・重ならない・間が刃厚以上', () => {
    expectValid(packBoard(bookshelfJob(), LUMBER_18_ID, 'horizontal'), LANDSCAPE_USABLE, KERF)
    expectValid(packBoard(bookshelfJob(), VENEER_4_ID, 'horizontal'), LANDSCAPE_USABLE, KERF)
  })

  it('帯を並べる長さ（1815）：912 + 3 + 900 はぴったり入り（2本目が x=0 に届く）、913 だと次の板', () => {
    const fit = packGuillotine([piece('a', 600, 900), piece('b', 600, 912)], LANDSCAPE_USABLE, 3, 'horizontal')
    expect(fit.sheets).toHaveLength(1)
    expect(placements(fit, 0).map((p) => p.x)).toEqual([903, 0])
    const over = packGuillotine([piece('a', 600, 900), piece('b', 600, 913)], LANDSCAPE_USABLE, 3, 'horizontal')
    expect(over.sheets).toHaveLength(2)
  })

  it('帯の中の長さ（905）：492 + 3 + 410 はぴったり（最後の片が y=0 に届く）、493 は入らない', () => {
    const fit = packGuillotine([piece('a', 410, 800), piece('b', 492, 800)], LANDSCAPE_USABLE, 3, 'horizontal')
    expect(fit.sheets[0].strips).toHaveLength(1)
    expect(placements(fit, 0).map((p) => [p.y, p.y + p.h])).toEqual([
      [413, 905],
      [0, 410],
    ])
    const over = packGuillotine([piece('a', 410, 800), piece('b', 493, 800)], LANDSCAPE_USABLE, 3, 'horizontal')
    expect(over.sheets[0].strips).toHaveLength(2)
  })

  it('刃厚ぶん入らない：905 に 452 + 452 は刃厚3があるので同じ帯に入らない（刃厚0なら入る）', () => {
    expect(packGuillotine([piece('a', 452, 800), piece('b', 452, 800)], LANDSCAPE_USABLE, 3, 'horizontal').sheets[0].strips).toHaveLength(2)
    expect(packGuillotine([piece('a', 452, 800), piece('b', 452, 800)], LANDSCAPE_USABLE, 0, 'horizontal').sheets[0].strips).toHaveLength(1)
  })

  it('長手 1815 ぴったりの片は入り、1816 は入らない（右の妻手を端切りするため）', () => {
    expect(packGuillotine([piece('a', 300, 1815)], LANDSCAPE_USABLE, 3, 'horizontal').sheets).toHaveLength(1)
    const r = packGuillotine([piece('a', 300, 1816)], LANDSCAPE_USABLE, 3, 'horizontal')
    expect(r.sheets).toEqual([])
    expect(r.unplaced.map((p) => p.partId)).toEqual(['a'])
  })

  it('帯より細い片は帯の右端に寄せ、前の片の下に刃厚をあけて置く', () => {
    const r = packGuillotine([piece('wide', 400, 1000), piece('narrow', 300, 800)], LANDSCAPE_USABLE, 3, 'horizontal')
    expect(r.sheets[0].strips).toHaveLength(1)
    expect(placements(r, 0).map((p) => rect(p))).toEqual([
      { x: 815, y: 505, w: 1000, h: 400 },
      { x: 1015, y: 202, w: 800, h: 300 },
    ])
  })

  it('150枚でも範囲内・重ならない・刃厚あき、すぐ終わる', () => {
    const ps: Piece[] = []
    for (let i = 0; i < 150; i++) ps.push(piece(`p${i}`, 100 + ((i * 37) % 400), 150 + ((i * 53) % 900), i % 3 === 0))
    const t = performance.now()
    const r = packGuillotine(ps, LANDSCAPE_USABLE, 3, 'horizontal')
    expect(performance.now() - t).toBeLessThan(200)
    expect(r.sheets.flatMap((_, i) => placements(r, i))).toHaveLength(150)
    expectValid(r, LANDSCAPE_USABLE, 3)
  })
})

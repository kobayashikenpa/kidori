import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { Job, Rect } from '../types'
import { packGuillotine, type StripMode } from './guillotine'
import { expandPieces, type Piece } from './pieces'
import { MIN_SCRAP, scrapsOf } from './scraps'
import { usableRect } from './sheet'

function sheetsOf(job: Job, boardId: string, mode: StripMode) {
  const g = expandPieces(job, computeDimensions(job)).groups.find((x) => x.board.id === boardId)!
  const r = packGuillotine(g.pieces, usableRect(g.board, job.settings.trim), job.settings.kerf, mode)
  return r.sheets.map((sh) => ({
    scraps: scrapsOf(sh, r.frame, job.settings.kerf),
    placements: sh.strips.flatMap((s) => s.items.map((i) => i.placement)),
  }))
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function expectClean(scraps: Rect[], placements: Rect[], usable: Rect, kerf: number) {
  for (const s of scraps) {
    // 使える範囲の中（耳落としと重ならない）
    expect(s.x).toBeGreaterThanOrEqual(usable.x)
    expect(s.y).toBeGreaterThanOrEqual(usable.y)
    expect(s.x + s.w).toBeLessThanOrEqual(usable.x + usable.w + 1e-9)
    expect(s.y + s.h).toBeLessThanOrEqual(usable.y + usable.h + 1e-9)
    expect(s.w).toBeGreaterThanOrEqual(MIN_SCRAP)
    expect(s.h).toBeGreaterThanOrEqual(MIN_SCRAP)
    // 片と重ならず、刃厚ぶんあく
    for (const p of placements) {
      expect(overlap(s, p)).toBe(false)
      const gapX = Math.max(p.x - (s.x + s.w), s.x - (p.x + p.w))
      const gapY = Math.max(p.y - (s.y + s.h), s.y - (p.y + p.h))
      expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(kerf - 1e-9)
    }
  }
  for (let i = 0; i < scraps.length; i++) {
    for (let j = i + 1; j < scraps.length; j++) expect(overlap(scraps[i], scraps[j])).toBe(false)
  }
}

const USABLE: Rect = { x: 0, y: 0, w: 905, h: 1820 }

function piece(id: string, x: number, y: number): Piece {
  return { pieceId: `${id}#1`, partId: id, name: id, sizeLabel: `${y}×${x}`, orientations: [{ x, y, rotated: false }] }
}

describe('scrapsOf（端材）', () => {
  it('端材として出すのは幅・長さとも 30mm 以上', () => {
    expect(MIN_SCRAP).toBe(30)
  })

  it('見本・縦切り優先の1枚目：左側 x 0〜79（79×1820）。帯の上の残り 410×7（刃厚3を除いた大きさ）は30mm未満なので出さない', () => {
    const [s1] = sheetsOf(bookshelfJob(), LUMBER_18_ID, 'vertical')
    expect(s1.scraps).toEqual([{ x: 0, y: 0, w: 79, h: 1820 }])
  })

  it('見本・縦切り優先の2枚目・3枚目：左側の残りと、各帯の上の残り（刃厚を除く）。大きい順', () => {
    const [, s2, s3] = sheetsOf(bookshelfJob(), LUMBER_18_ID, 'vertical')
    expect(s2.scraps).toEqual([
      { x: 0, y: 0, w: 99, h: 1820 },
      { x: 495, y: 1754, w: 410, h: 66 },
      { x: 102, y: 1752, w: 390, h: 68 },
    ])
    expect(s3.scraps).toEqual([
      { x: 0, y: 0, w: 512, h: 1820 },
      { x: 515, y: 1752, w: 390, h: 68 },
    ])
  })

  it('見本・横切り優先の3枚目：奥の残り 905×944 と、帯の左の残り 119×873', () => {
    const s3 = sheetsOf(bookshelfJob(), LUMBER_18_ID, 'horizontal')[2]
    expect(s3.scraps).toEqual([
      { x: 0, y: 876, w: 905, h: 944 },
      { x: 0, y: 0, w: 119, h: 873 },
    ])
  })

  it('見本のベニヤは端材なし（残りは 2mm と 17mm）', () => {
    expect(sheetsOf(bookshelfJob(), VENEER_4_ID, 'vertical')[0].scraps).toEqual([])
  })

  it('見本のすべての端材が、片・耳落とし・ほかの端材と重ならない', () => {
    for (const mode of ['vertical', 'horizontal'] as const) {
      for (const id of [LUMBER_18_ID, VENEER_4_ID]) {
        for (const s of sheetsOf(bookshelfJob(), id, mode)) expectClean(s.scraps, s.placements, USABLE, 3)
      }
    }
  })

  it('帯より細い片の横の残り（刃厚を除く）も端材にする', () => {
    const r = packGuillotine([piece('wide', 400, 1000), piece('narrow', 300, 800)], USABLE, 3, 'vertical')
    const scraps = scrapsOf(r.sheets[0], r.frame, 3)
    expect(scraps).toContainEqual({ x: 505, y: 1003, w: 97, h: 800 })
  })

  it('30mm ちょうどは出し、29.9mm は出さない', () => {
    // 左の残り：905 − 872 − 刃厚3 = 30
    const at30 = packGuillotine([piece('a', 872, 1820)], USABLE, 3, 'vertical')
    expect(scrapsOf(at30.sheets[0], at30.frame, 3)).toEqual([{ x: 0, y: 0, w: 30, h: 1820 }])
    const at299 = packGuillotine([piece('a', 872.1, 1820)], USABLE, 3, 'vertical')
    expect(scrapsOf(at299.sheets[0], at299.frame, 3)).toEqual([])
  })

  it('たくさんの片でも端材が片と重ならない', () => {
    const ps: Piece[] = []
    for (let i = 0; i < 150; i++) ps.push(piece(`p${i}`, 100 + ((i * 37) % 400), 150 + ((i * 53) % 900)))
    for (const mode of ['vertical', 'horizontal'] as const) {
      const r = packGuillotine(ps, USABLE, 3, mode)
      for (const sh of r.sheets) {
        expectClean(scrapsOf(sh, r.frame, 3), sh.strips.flatMap((s) => s.items.map((i) => i.placement)), USABLE, 3)
      }
    }
  })
})

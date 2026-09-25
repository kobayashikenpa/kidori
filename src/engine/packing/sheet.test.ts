import { describe, expect, it } from 'vitest'
import { BOARD_SIZES, type Board } from '../types'
import { fitsInLength, lengthUsed, sheetOrientation, trimRects, usableRect } from './sheet'

const saburoku: Board = {
  id: 'b',
  material: 'シナランバー',
  thickness: 18,
  sizeKind: 'saburoku',
  width: BOARD_SIZES.saburoku[0],
  length: BOARD_SIZES.saburoku[1],
  grain: 'long',
}

describe('usableRect（耳落とし後に使える範囲）', () => {
  it('サブロク・耳落とし5 → x 0〜905・y 0〜1820（耳落としは刃厚を含む）', () => {
    expect(usableRect(saburoku, 5)).toEqual({ x: 0, y: 0, w: 905, h: 1820 })
  })

  it('耳落とし0 なら板の全体', () => {
    expect(usableRect(saburoku, 0)).toEqual({ x: 0, y: 0, w: 910, h: 1820 })
  })

  it('シハチ・耳落とし10 → 1210×2440', () => {
    expect(usableRect({ ...saburoku, width: 1220, length: 2440 }, 10)).toEqual({ x: 0, y: 0, w: 1210, h: 2440 })
  })
})

describe('横切り優先（横長に置く）の使える範囲と端切り', () => {
  it('置き方：縦切り優先は縦長（portrait）、横切り優先は横長（landscape）', () => {
    expect(sheetOrientation('vertical')).toBe('portrait')
    expect(sheetOrientation('horizontal')).toBe('landscape')
  })

  it('横長のサブロク・端切り5 → x 0〜1815（長手方向）・y 0〜905（妻手方向）。上の長手と右の妻手を落とす', () => {
    expect(usableRect(saburoku, 5, 'horizontal')).toEqual({ x: 0, y: 0, w: 1815, h: 905 })
  })

  it('縦切り優先を明示しても今までと同じ', () => {
    expect(usableRect(saburoku, 5, 'vertical')).toEqual({ x: 0, y: 0, w: 905, h: 1820 })
  })

  it('端切りで落とす部分：縦切り優先は右の長手だけ', () => {
    expect(trimRects(saburoku, 5, 'vertical')).toEqual([{ x: 905, y: 0, w: 5, h: 1820 }])
  })

  it('端切りで落とす部分：横切り優先は 上の長手（全長）→ 右の妻手（上を落とした残りの高さ）の順', () => {
    expect(trimRects(saburoku, 5, 'horizontal')).toEqual([
      { x: 0, y: 905, w: 1820, h: 5 },
      { x: 1815, y: 0, w: 5, h: 905 },
    ])
  })

  it('端切り0 なら落とす部分はない', () => {
    expect(trimRects(saburoku, 0, 'vertical')).toEqual([])
    expect(trimRects(saburoku, 0, 'horizontal')).toEqual([])
  })
})

describe('fitsInLength（刃厚込みで並べられるか）', () => {
  it('L=823 に 410 と 410 が入る（410 + 刃厚3 + 410）', () => {
    expect(fitsInLength([410, 410], 3, 823)).toBe(true)
  })

  it('L=822 には入らない（1mm 足りない）', () => {
    expect(fitsInLength([410, 410], 3, 822)).toBe(false)
  })

  it('L=905 に 905 が1枚ぴったり入る（板の端では刃厚を引かない）', () => {
    expect(fitsInLength([905], 3, 905)).toBe(true)
    expect(fitsInLength([905.1], 3, 905)).toBe(false)
  })

  it('刃厚ぶんで入らない：820 には 410 + 410 は入らない（合計はちょうど 820）', () => {
    expect(fitsInLength([410, 410], 3, 820)).toBe(false)
  })

  it('浮動小数の誤差で判定がずれない（0.1 + 0.2 など）', () => {
    expect(fitsInLength([0.1, 0.2], 0, 0.3)).toBe(true)
    expect(fitsInLength([300.1, 300.2], 0.3, 600.6)).toBe(true)
  })

  it('何も並べないときは入る', () => {
    expect(fitsInLength([], 3, 0)).toBe(true)
  })
})

describe('lengthUsed（刃厚込みで使う長さ）', () => {
  it('片の合計 + 刃厚 ×（枚数 − 1）', () => {
    expect(lengthUsed([410, 410], 3)).toBe(823)
    expect(lengthUsed([874, 874], 3)).toBe(1751)
    expect(lengthUsed([905], 3)).toBe(905)
    expect(lengthUsed([], 3)).toBe(0)
  })
})

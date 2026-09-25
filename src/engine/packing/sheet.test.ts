import { describe, expect, it } from 'vitest'
import { BOARD_SIZES, type Board } from '../types'
import { fitsInLength, lengthUsed, usableRect } from './sheet'

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

import { describe, expect, it } from 'vitest'
import { AXES, BOARD_SIZES, DEFAULT_SETTINGS } from './types'

describe('AXES', () => {
  it('W・H・D の順で並ぶ', () => {
    expect(AXES).toEqual(['W', 'H', 'D'])
  })
})

describe('DEFAULT_SETTINGS（仕事の設定の初期値）', () => {
  it('刃厚3・耳落とし5・切り代10・縦切り優先', () => {
    expect(DEFAULT_SETTINGS).toEqual({ kerf: 3, trim: 5, allowance: 10, cutMode: 'vertical' })
  })
})

describe('BOARD_SIZES（定尺板の大きさ）', () => {
  it('サブロクは 910×1820', () => {
    expect(BOARD_SIZES.saburoku).toEqual([910, 1820])
  })
  it('シハチは 1220×2440', () => {
    expect(BOARD_SIZES.shihachi).toEqual([1220, 2440])
  })
})

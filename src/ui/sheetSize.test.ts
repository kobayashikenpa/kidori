// U-69：まとめの行のサイズの選択肢（組の行は 3×6／4×8 だけ。architecture.md 15.9）
import { describe, expect, it } from 'vitest'
import { selectedSize, sizeChoices } from './sheetSize'

const S36 = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const

describe('sizeChoices', () => {
  it('材料の行は 3×6・4×8・自由入力の3つ', () => {
    expect(sizeChoices('board-lauan-4')).toEqual(['saburoku', 'shihachi', 'free'])
  })
  it('重ね切りの組の行は 3×6・4×8 の2つだけ（自由入力を出さない）', () => {
    expect(sizeChoices(['board-melamine-1', 'board-lauan-4'])).toEqual(['saburoku', 'shihachi'])
  })
})

describe('selectedSize', () => {
  it('材料の行：手持ち（stockOn）・以前の自由入力は自由入力、それ以外は 3×6／4×8', () => {
    expect(selectedSize('b', S36)).toBe('saburoku')
    expect(selectedSize('b', { ...S36, stockOn: true, stock: [{ id: 's', ...S36, count: 1 }] })).toBe('free')
    expect(selectedSize('b', { ...S36, sizeKind: 'custom' })).toBe('free')
  })
  it('組の行：手持ち・自由入力が残っていても自由入力にならない（自由入力なら 4×8）', () => {
    expect(selectedSize(['a', 'b'], { ...S36, stockOn: true, stock: [{ id: 's', ...S36, count: 1 }] })).toBe('saburoku')
    expect(selectedSize(['a', 'b'], { ...S36, sizeKind: 'custom' })).toBe('shihachi')
    expect(selectedSize(['a', 'b'], S48)).toBe('shihachi')
  })
})

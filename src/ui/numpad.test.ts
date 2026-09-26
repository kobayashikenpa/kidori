import { describe, expect, it } from 'vitest'
import { pressKey } from './numpad'

describe('pressKey', () => {
  it('開いた直後の数字は入れ替え、そのあとは足す', () => {
    expect(pressKey('3', '5', true, false)).toBe('5')
    expect(pressKey('5', '2', false, false)).toBe('52')
  })
  it('⌫ は1字消し、クリアは空にする', () => {
    expect(pressKey('15.5', 'back', false, false)).toBe('15.')
    expect(pressKey('15', 'clear', false, false)).toBe('')
  })
  it('小数点は1つだけ。整数だけの欄では入らない', () => {
    expect(pressKey('', '.', false, false)).toBe('0.')
    expect(pressKey('15.5', '.', false, false)).toBe('15.5')
    expect(pressKey('3', '.', true, false)).toBe('0.')
    expect(pressKey('2', '.', false, true)).toBe('2')
  })
  it('先頭の0は置きかえ、桁が多すぎれば入れない', () => {
    expect(pressKey('0', '7', false, false)).toBe('7')
    expect(pressKey('12345678', '9', false, false)).toBe('12345678')
  })
})

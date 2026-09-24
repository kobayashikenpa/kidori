import { describe, expect, it } from 'vitest'
import { eq1, round1 } from './round'

describe('round1・eq1（小数第1位に丸めて比べる）', () => {
  it('小数第1位に丸める', () => {
    expect(round1(12.34)).toBe(12.3)
    expect(round1(12.35)).toBe(12.4)
    expect(round1(0.1 + 0.2)).toBe(0.3)
  })
  it('浮動小数の誤差があっても同じ値とみなす', () => {
    expect(eq1(0.1 + 0.2, 0.3)).toBe(true)
    expect(eq1(18, 18.04)).toBe(true)
    expect(eq1(18, 18.1)).toBe(false)
  })
})

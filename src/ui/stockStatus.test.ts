import { describe, expect, it } from 'vitest'
import { stockRowStatus } from './stockStatus'

describe('stockRowStatus', () => {
  it('仕様書 9 の4つの表示', () => {
    expect(stockRowStatus(0, 3, true).text).toBe('不採用')
    expect(stockRowStatus(0, 3, false).text).toBe('不採用')
    expect(stockRowStatus(2, 3, false).text).toBe('2枚採用')
    expect(stockRowStatus(2, 5, true).text).toBe('2枚採用')
    expect(stockRowStatus(3, 3, false).text).toBe('採用')
    expect(stockRowStatus(3, 3, true).text).toBe('採用')
  })
})

import { describe, expect, it } from 'vitest'
import { stockRowStatus } from './stockStatus'

describe('stockRowStatus', () => {
  it('仕様書 9 の手持ちの行の3つの表示（不採用・◯枚採用・採用）', () => {
    expect(stockRowStatus(0, 3)).toEqual({ kind: 'unused', text: '不採用' })
    expect(stockRowStatus(2, 3)).toEqual({ kind: 'part', text: '2枚採用' })
    expect(stockRowStatus(2, 5).text).toBe('2枚採用')
    expect(stockRowStatus(3, 3)).toEqual({ kind: 'all', text: '採用' })
  })
})

import { describe, expect, it } from 'vitest'
import { AXES } from './types'

describe('AXES', () => {
  it('W・H・D の順で並ぶ', () => {
    expect(AXES).toEqual(['W', 'H', 'D'])
  })
})

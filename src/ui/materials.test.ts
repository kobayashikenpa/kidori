import { describe, expect, it } from 'vitest'
import { materialLabel, materialRuns } from './materials'

describe('materialRuns', () => {
  it('隣り合う同じ材料名をまとめ、並びは変えない', () => {
    const runs = materialRuns([
      { material: '芯材' },
      { material: 'ラワン' },
      { material: 'ラワン ' },
      { material: 'シナ' },
      { material: 'ラワン' },
    ])
    expect(runs.map((r) => [r.name, r.boards.length])).toEqual([
      ['芯材', 1],
      ['ラワン', 2],
      ['シナ', 1],
      ['ラワン', 1],
    ])
  })
})

describe('materialLabel', () => {
  it('木取りしない材料は印を付ける', () => {
    expect(materialLabel({ material: '芯材', thickness: 15, noCut: true })).toBe('芯材 15mm（木取りしない）')
    expect(materialLabel({ material: 'ラワン', thickness: 4 })).toBe('ラワン 4mm')
  })
})

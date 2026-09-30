import { describe, expect, it } from 'vitest'
import { materialLabel, materialNameGroups, materialRuns } from './materials'

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

describe('materialNameGroups', () => {
  it('離れていても同じ材料名を1行にまとめ、名前は最初に出てくる順・厚みは小さい順', () => {
    const groups = materialNameGroups([
      { material: 'ラワン', thickness: 9 },
      { material: '芯材', thickness: 15 },
      { material: 'ラワン ', thickness: 4 },
      { material: 'シナ', thickness: 18 },
      { material: 'ラワン', thickness: 2.5 },
    ])
    expect(groups.map((g) => [g.name, g.boards.map((b) => b.thickness)])).toEqual([
      ['ラワン', [2.5, 4, 9]],
      ['芯材', [15]],
      ['シナ', [18]],
    ])
  })

  it('空なら空', () => {
    expect(materialNameGroups([])).toEqual([])
  })
})

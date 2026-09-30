// E-83（第2.9版。仕様書 9.4）：端材の行を、同じ大きさ・同じ重ねた板ごとにまとめ、使う・使わないに分ける
import { describe, expect, it } from 'vitest'
import type { OffcutUsage } from './frozen'
import { groupOffcuts } from './offcutGroups'

const row = (id: string, width: number, length: number, source: number, used: number): OffcutUsage => ({
  stockId: id,
  label: `端材 ${width}×${length}（重ねた板${source}から）`,
  width,
  length,
  source,
  count: 1,
  used,
})

describe('groupOffcuts', () => {
  it('同じ大きさ・同じ重ねた板の端材を1行にまとめ、「×2枚」を名前に入れる', () => {
    const g = groupOffcuts([row('a', 96, 390, 4, 0), row('b', 96, 390, 4, 0), row('c', 96, 390, 3, 0)])
    expect(g.unused.map((x) => [x.label, x.count, x.used])).toEqual([
      ['端材 96×390 ×2枚（重ねた板4から）', 2, 0],
      ['端材 96×390（重ねた板3から）', 1, 0],
    ])
    expect(g.used).toEqual([])
    expect(g.unusedCount).toBe(3)
  })

  it('1枚でも使う行は used に、使った枚数を足し合わせる。並びは元の並び', () => {
    const g = groupOffcuts([row('a', 102, 1820, 1, 1), row('b', 50, 800, 2, 0), row('c', 102, 1820, 1, 0), row('d', 102, 1820, 1, 1)])
    expect(g.used.map((x) => [x.label, x.count, x.used, x.stockIds])).toEqual([
      ['端材 102×1820 ×3枚（重ねた板1から）', 3, 2, ['a', 'c', 'd']],
    ])
    expect(g.unused.map((x) => x.label)).toEqual(['端材 50×800（重ねた板2から）'])
    expect(g.usedCount).toBe(2)
    expect(g.unusedCount).toBe(1)
  })

  it('大きさが違えば別の行（小数第1位まで）', () => {
    const g = groupOffcuts([row('a', 96.5, 390, 4, 0), row('b', 96, 390, 4, 0)])
    expect(g.unused.map((x) => x.label)).toEqual(['端材 96.5×390（重ねた板4から）', '端材 96×390（重ねた板4から）'])
  })

  it('同じ行で3枚中3枚使うと used が 3（採用）', () => {
    const g = groupOffcuts([row('a', 96, 390, 4, 1), row('b', 96, 390, 4, 1), row('c', 96, 390, 4, 1)])
    expect(g.used.map((x) => [x.label, x.count, x.used])).toEqual([['端材 96×390 ×3枚（重ねた板4から）', 3, 3]])
    expect(g.usedCount).toBe(3)
    expect(g.unusedCount).toBe(0)
  })

  it('3枚中2枚使う行の余り1枚は unusedCount に数えない（使う行に残る）', () => {
    const g = groupOffcuts([row('a', 96, 390, 4, 1), row('b', 96, 390, 4, 0), row('c', 96, 390, 4, 1)])
    expect(g.used.map((x) => [x.count, x.used])).toEqual([[3, 2]])
    expect(g.unused).toEqual([])
    expect(g.unusedCount).toBe(0)
  })

  it('端材が無ければ空', () => {
    expect(groupOffcuts([])).toEqual({ used: [], unused: [], usedCount: 0, unusedCount: 0 })
  })
})

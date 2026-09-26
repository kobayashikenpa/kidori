import { describe, expect, it } from 'vitest'
import { formulaUnits } from './units'

/** 単位の種類と文字列だけを取り出す */
function units(expr: string) {
  return formulaUnits(expr).map((u) => [u.kind, expr.slice(u.start, u.end)])
}

describe('formulaUnits（カーソルで動く単位）', () => {
  it('全体.W - {n:nige-1} * 12 は［全体.W, -, 逃げ, *, 1, 2］の6つ', () => {
    expect(units('全体.W - {n:nige-1} * 12')).toEqual([
      ['partRef', '全体.W'],
      ['op', '-'],
      ['nige', '{n:nige-1}'],
      ['op', '*'],
      ['digit', '1'],
      ['digit', '2'],
    ])
  })

  it('空白は単位にしない。位置は保存した文字列の位置', () => {
    const u = formulaUnits(' 1 +  {t:b-4}')
    expect(u.map((x) => [x.kind, x.start, x.end])).toEqual([
      ['digit', 1, 2],
      ['op', 3, 4],
      ['thickness', 6, 13],
    ])
  })

  it('小数点も1文字ずつ、括弧も単位', () => {
    expect(units('(12.5)')).toEqual([
      ['paren', '('],
      ['digit', '1'],
      ['digit', '2'],
      ['digit', '.'],
      ['digit', '5'],
      ['paren', ')'],
    ])
  })

  it('空白なしでもそれぞれの単位に分かれる', () => {
    expect(units('側板.W*2-{t:b-4}')).toEqual([
      ['partRef', '側板.W'],
      ['op', '*'],
      ['digit', '2'],
      ['op', '-'],
      ['thickness', '{t:b-4}'],
    ])
  })

  it('全角の記号・数字も読む', () => {
    expect(units('９×２')).toEqual([
      ['digit', '９'],
      ['op', '×'],
      ['digit', '２'],
    ])
  })

  it('読めない文字のかたまりは bad の1単位（古いデータ用）', () => {
    expect(units('900 - abc + {x:1}')).toEqual([
      ['digit', '9'],
      ['digit', '0'],
      ['digit', '0'],
      ['op', '-'],
      ['bad', 'abc'],
      ['op', '+'],
      ['bad', '{x:1}'],
    ])
  })

  it('閉じていない { は式の終わりまでが bad の1単位', () => {
    expect(units('1 + {n:nige-1')).toEqual([
      ['digit', '1'],
      ['op', '+'],
      ['bad', '{n:nige-1'],
    ])
  })

  it('空の式は単位なし', () => {
    expect(formulaUnits('')).toEqual([])
    expect(formulaUnits('   ')).toEqual([])
  })
})

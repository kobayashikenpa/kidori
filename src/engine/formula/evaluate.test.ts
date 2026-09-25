import { describe, expect, it } from 'vitest'
import { evaluate, evaluateExpr, refsOf } from './evaluate'
import { parse } from './parse'

/** 参照のない式を計算する */
function calc(expr: string) {
  return evaluateExpr(expr, () => null)
}

describe('parse・evaluate（式の構文解析と計算）', () => {
  it('(900 - 18 * 2) / 2 = 432', () => {
    expect(calc('(900 - 18 * 2) / 2')).toEqual({ ok: true, value: 432 })
  })

  it('掛け算・割り算は足し算・引き算より先', () => {
    expect(calc('900 - 18 * 2')).toEqual({ ok: true, value: 864 })
    expect(calc('10 + 6 / 3')).toEqual({ ok: true, value: 12 })
  })

  it('同じ強さの記号は左から順に計算する', () => {
    expect(calc('100 - 10 - 5')).toEqual({ ok: true, value: 85 })
    expect(calc('100 / 10 / 5')).toEqual({ ok: true, value: 2 })
  })

  it('-5 + 10 = 5（先頭の - は符号）', () => {
    expect(calc('-5 + 10')).toEqual({ ok: true, value: 5 })
  })

  it('( の直後の - も符号', () => {
    expect(calc('10 * (-2 + 5)')).toEqual({ ok: true, value: 30 })
  })

  it('小数も計算できる', () => {
    expect(calc('12.5 * 2')).toEqual({ ok: true, value: 25 })
  })

  it('数値だけの式', () => {
    expect(calc('900')).toEqual({ ok: true, value: 900 })
  })

  it.each(['1 +', '(1', '1)', '* 2', '1 2', '()', '1 + * 2'])('%s は構文エラー', (expr) => {
    const r = calc(expr)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('syntax')
  })

  it('空の式は構文エラー', () => {
    const r = calc('  ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('syntax')
  })

  it('読めない字句（@）は構文エラー', () => {
    const r = calc('10 @ 2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('syntax')
  })

  it('10 / 0 は 0 除算エラー', () => {
    const r = calc('10 / 0')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('divideByZero')
  })

  it('割る数が計算の結果 0 になるときも 0 除算エラー', () => {
    const r = calc('10 / (5 - 5)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('divideByZero')
  })

  it('参照の値を渡して計算する', () => {
    const values: Record<string, number> = { '全体.W': 900, '側板.W': 18 }
    expect(evaluateExpr('全体.W - 側板.W * 2', (part, axis) => values[`${part}.${axis}`] ?? null)).toEqual({
      ok: true,
      value: 864,
    })
  })

  it('値のない参照は unknownRef エラー（部材名を示す）', () => {
    const r = evaluateExpr('天板.W + 1', () => null)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('unknownRef')
      expect(r.error.refs).toEqual(['天板'])
    }
  })
})

describe('refsOf（参照の一覧）', () => {
  function refs(expr: string) {
    const r = parse(expr)
    if (!r.ok) throw new Error(r.error.message)
    return refsOf(r.ast)
  }

  it('全体.W - 側板.W * 2 の参照は［全体.W, 側板.W］', () => {
    expect(refs('全体.W - 側板.W * 2')).toEqual([
      { part: '全体', axis: 'W' },
      { part: '側板', axis: 'W' },
    ])
  })

  it('同じ参照は1回だけ、出てきた順に並ぶ', () => {
    expect(refs('(全体.D - 天板.H) + 全体.D * 2')).toEqual([
      { part: '全体', axis: 'D' },
      { part: '天板', axis: 'H' },
    ])
  })

  it('数値だけの式は参照なし', () => {
    expect(refs('900')).toEqual([])
  })

  it('構文解析した式は evaluate で何度でも計算できる', () => {
    const r = parse('全体.W / 2')
    if (!r.ok) throw new Error(r.error.message)
    expect(evaluate(r.ast, () => 900)).toEqual({ ok: true, value: 450 })
    expect(evaluate(r.ast, () => 600)).toEqual({ ok: true, value: 300 })
  })
})

describe('全角の記号・数字の式も計算できる', () => {
  it.each([
    ['900＋10', 910],
    ['９００×2', 1800],
    ['（900）', 900],
    ['900 ÷ 2', 450],
    ['900 − 10', 890],
    ['900 – 10 — 10', 880],
    ['3 ✕ 3', 9],
    ['－５＋１０', 5],
  ])('%s = %d', (expr, value) => {
    expect(calc(expr)).toEqual({ ok: true, value })
  })

  it('全体．Ｗ の参照', () => {
    expect(evaluateExpr('全体．Ｗ − 100', (part, axis) => (part === '全体' && axis === 'W' ? 900 : null))).toEqual({
      ok: true,
      value: 800,
    })
  })
})

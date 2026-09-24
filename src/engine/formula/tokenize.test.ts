import { describe, expect, it } from 'vitest'
import { normalizeFormulaText, tokenize, validatePartName } from './tokenize'

/** 位置の情報を除いて、字句の中身だけを比べる */
function kinds(expr: string) {
  const r = tokenize(expr)
  if (!r.ok) throw new Error(r.message)
  return r.tokens.map((t) => {
    switch (t.type) {
      case 'number':
        return { number: t.value }
      case 'ref':
        return { ref: [t.part, t.axis] }
      default:
        return t.type
    }
  })
}

describe('tokenize（式の字句の切り出し）', () => {
  it('全体.W - 側板.W * 2 → 参照(全体,W), -, 参照(側板,W), *, 数値2', () => {
    expect(kinds('全体.W - 側板.W * 2')).toEqual([
      { ref: ['全体', 'W'] },
      '-',
      { ref: ['側板', 'W'] },
      '*',
      { number: 2 },
    ])
  })

  it('空白がなくても区切れる', () => {
    expect(kinds('全体.W-側板.W*2')).toEqual([{ ref: ['全体', 'W'] }, '-', { ref: ['側板', 'W'] }, '*', { number: 2 }])
  })

  it('12.5 は数値', () => {
    expect(kinds('12.5')).toEqual([{ number: 12.5 }])
  })

  it('括弧と割り算', () => {
    expect(kinds('(900-18*2)/2')).toEqual(['(', { number: 900 }, '-', { number: 18 }, '*', { number: 2 }, ')', '/', { number: 2 }])
  })

  it('H・D の参照も読める', () => {
    expect(kinds('全体.H+全体.D')).toEqual([{ ref: ['全体', 'H'] }, '+', { ref: ['全体', 'D'] }])
  })

  it('数字で始まる部材名も参照として読める（数値とは . の後ろが W/H/D かで区別できる）', () => {
    expect(kinds('2段目棚板.W')).toEqual([{ ref: ['2段目棚板', 'W'] }])
  })

  it('全角の空白も区切りとして読み飛ばす', () => {
    expect(kinds('全体.W　-　10')).toEqual([{ ref: ['全体', 'W'] }, '-', { number: 10 }])
  })

  it('字句の位置（何文字目から何文字目か）を返す', () => {
    const r = tokenize('全体.W - 2')
    expect(r.ok && r.tokens.map((t) => [t.start, t.end])).toEqual([
      [0, 4],
      [5, 6],
      [7, 8],
    ])
  })

  it('天地板.X は字句のエラー', () => {
    const r = tokenize('天地板.X + 1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain('天地板.X')
      expect(r.start).toBe(0)
    }
  })

  it('@ は字句のエラー', () => {
    const r = tokenize('10 @ 2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('@')
  })

  it('部材名だけ（.W などなし）はエラー', () => {
    expect(tokenize('全体').ok).toBe(false)
  })

  it('小数点が2つある数値や、. で始まる数値はエラー', () => {
    expect(tokenize('1.2.3').ok).toBe(false)
    expect(tokenize('.5').ok).toBe(false)
    expect(tokenize('5.').ok).toBe(false)
  })

  it('空の式は字句なし（空かどうかの判断は構文解析で行う）', () => {
    expect(tokenize('   ')).toEqual({ ok: true, tokens: [] })
  })
})

describe('validatePartName（部材名に使えるか）', () => {
  it('普通の名前は使える', () => {
    expect(validatePartName('側板')).toBeNull()
    expect(validatePartName('2段目棚板')).toBeNull()
  })

  it('空の名前は使えない', () => {
    expect(validatePartName('')).not.toBeNull()
  })

  it.each(['側+板', '側-板', '側*板', '側/板', '側(板', '側)板', '側.板', '側 板', '側　板'])(
    '記号・空白を含む名前（%s）は使えない',
    (name) => {
      expect(validatePartName(name)).not.toBeNull()
    },
  )

  it('ほかの部材と同じ名前は使えない', () => {
    expect(validatePartName('側板', ['全体', '側板'])).toContain('側板')
  })
})

describe('全角の記号・数字（入力の揺れを吸収する）', () => {
  it('normalizeFormulaText：全角を半角に、× ✕ ÷ − – — を * / - に', () => {
    expect(normalizeFormulaText('（９００＋１０）×２÷４−１–１—１✕１')).toBe('(900+10)*2/4-1-1-1*1')
  })

  it('ー（長音）は置き換えない（部材名に使うため）', () => {
    expect(normalizeFormulaText('ボード.W')).toBe('ボード.W')
  })

  it('全体．Ｗ は 全体.W の参照', () => {
    expect(kinds('全体．Ｗ')).toEqual([{ ref: ['全体', 'W'] }])
  })

  it('字句の位置は、入力したままの文字の位置', () => {
    const r = tokenize('９００　＋　全体．Ｗ')
    expect(r.ok && r.tokens.map((t) => [t.start, t.end])).toEqual([
      [0, 3],
      [4, 5],
      [6, 10],
    ])
  })

  it('全角の数字は数値', () => {
    expect(kinds('１２．５')).toEqual([{ number: 12.5 }])
  })

  it.each(['側＋板', '側−板', '側×板', '側÷板', '側．板', '側（板', '側–板'])(
    '全角の記号や × ÷ − を含む名前（%s）は使えない',
    (name) => {
      expect(validatePartName(name)).not.toBeNull()
    },
  )

  it('全角・半角だけが違う名前は同じ名前とみなす', () => {
    expect(validatePartName('棚板１', ['棚板1'])).not.toBeNull()
  })

  it('長音 ー を含む名前は使える', () => {
    expect(validatePartName('ボード')).toBeNull()
  })
})

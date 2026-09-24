import { describe, expect, it } from 'vitest'
import { backspace, insertKey, insertRef, type Edit, type PadKey } from './formulaEdit'

/** ボタンを順に押したときの式 */
function press(...keys: (PadKey | { ref: string } | 'BS')[]): string {
  let e: Edit = { text: '', caret: 0 }
  for (const k of keys) {
    if (k === 'BS') e = backspace(e.text, e.caret)
    else if (typeof k === 'object') e = insertRef(e.text, e.caret, k.ref)
    else e = insertKey(e.text, e.caret, k)
  }
  return e.text
}

describe('ボタンだけで式を作る', () => {
  it('天地板 W＝全体.W - 側板.W * 2', () => {
    expect(press({ ref: '全体.W' }, '-', { ref: '側板.W' }, '*', '2')).toBe('全体.W - 側板.W * 2')
  })
  it('棚板 D＝全体.D - 20', () => {
    expect(press({ ref: '全体.D' }, '-', '2', '0')).toBe('全体.D - 20')
  })
  it('括弧と小数', () => {
    expect(press('(', '9', '0', '0', '-', '1', '8', ')', '/', '2', '.', '5')).toBe('(900 - 18) / 2.5')
  })
  it('先頭の - は空白を入れない', () => {
    expect(press('-', '5')).toBe('- 5')
  })
})

describe('カーソル位置に入れる', () => {
  it('途中に入れるとカーソルがその後ろに来る', () => {
    expect(insertKey('900', 1, '5')).toEqual({ text: '9500', caret: 2 })
    expect(insertRef('- 20', 0, '全体.D')).toEqual({ text: '全体.D- 20', caret: 4 })
  })
  it('演算子の後ろに空白があれば足さない', () => {
    expect(insertKey('全体.W 2', 4, '*')).toEqual({ text: '全体.W * 2', caret: 6 })
  })
})

describe('1字消す', () => {
  it('数字は1字ずつ', () => {
    expect(press('1', '2', 'BS')).toBe('1')
  })
  it('参照は参照ごと、前の空白と演算子は1字ずつ', () => {
    expect(press({ ref: '全体.W' }, '-', { ref: '側板.W' }, 'BS')).toBe('全体.W - ')
    expect(press({ ref: '全体.W' }, '-', 'BS')).toBe('全体.W ')
  })
  it('空なら何もしない', () => {
    expect(backspace('', 0)).toEqual({ text: '', caret: 0 })
  })
})

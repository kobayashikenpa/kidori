import { describe, expect, it } from 'vitest'
import { formulaUnits } from '../engine/formula/units'
import { clearAll, deleteBefore, insertAt, moveLeft, moveRight, unitCount, type Edit, type PadKey } from './formulaEdit'

type Press = PadKey | { ref: string } | 'BS' | '◀' | '▶'

/** 空の式からボタンを順に押したときの結果 */
function press(...keys: Press[]): Edit {
  let e: Edit = { text: '', cursor: 0 }
  for (const k of keys) e = pressOn(e, k)
  return e
}

function pressOn(e: Edit, k: Press): Edit {
  if (k === 'BS') return deleteBefore(e.text, e.cursor)
  if (k === '◀') return { ...e, cursor: moveLeft(e.text, e.cursor) }
  if (k === '▶') return { ...e, cursor: moveRight(e.text, e.cursor) }
  if (typeof k === 'object') return insertAt(e.text, e.cursor, k.ref)
  return insertAt(e.text, e.cursor, k)
}

describe('ボタンだけで式を作る', () => {
  it('天地板 W＝全体.W - 側板.W * 2', () => {
    expect(press({ ref: '全体.W' }, '-', { ref: '側板.W' }, '*', '2')).toEqual({ text: '全体.W - 側板.W * 2', cursor: 5 })
  })
  it('棚板 W＝天地板.W - 逃げ1mm（{n:…} は1つの単位）', () => {
    const e = press({ ref: '天地板.W' }, '-', { ref: '{n:nige-1}' })
    expect(e).toEqual({ text: '天地板.W - {n:nige-1}', cursor: 3 })
  })
  it('棚板 D＝全体.D - 20', () => {
    expect(press({ ref: '全体.D' }, '-', '2', '0').text).toBe('全体.D - 20')
  })
  it('括弧と小数', () => {
    expect(press('(', '9', '0', '0', '-', '1', '8', ')', '/', '2', '.', '5').text).toBe('(900 - 18) / 2.5')
  })
  it('先頭の - は前に空白を入れない', () => {
    expect(press('-', '5').text).toBe('- 5')
  })
  it('数字のすぐ後ろに参照を入れても、くっつかない', () => {
    expect(press('2', { ref: '全体.W' }).text).toBe('2 全体.W')
    expect(press({ ref: '全体.W' }, '2').text).toBe('全体.W 2')
  })
})

describe('カーソルの左右移動', () => {
  it('全体.W - 側板.W * 2 の末尾から ◀ 3回で 側板.W の前（塊は1回で越える）、そこで1字消すと - が消える', () => {
    const start = press({ ref: '全体.W' }, '-', { ref: '側板.W' }, '*', '2')
    let e = pressOn(start, '◀')
    e = pressOn(e, '◀')
    expect(e.cursor).toBe(3) // 側板.W の後ろ
    e = pressOn(e, '◀')
    expect(e.cursor).toBe(2) // 側板.W の前
    const units = formulaUnits(e.text)
    expect(units[e.cursor].text).toBe('側板.W')
    const del = pressOn(e, 'BS')
    expect(del).toEqual({ text: '全体.W 側板.W * 2', cursor: 1 })
  })
  it('12 の間にカーソルを置いて 3 を押すと 132', () => {
    const e = press('1', '2', '◀', '3')
    expect(e).toEqual({ text: '132', cursor: 2 })
  })
  it('端より先には動かない', () => {
    expect(moveLeft('12', 0)).toBe(0)
    expect(moveRight('12', 2)).toBe(2)
    expect(moveRight('全体.W - 1', 1)).toBe(2)
  })
  it('先頭に入れる', () => {
    expect(insertAt('- 20', 0, '全体.D')).toEqual({ text: '全体.D - 20', cursor: 1 })
  })
})

describe('1字消す・全部消す', () => {
  it('数字は1字ずつ', () => {
    expect(press('1', '2', 'BS')).toEqual({ text: '1', cursor: 1 })
  })
  it('参照・逃げは塊ごと、前の空白もいっしょに消す', () => {
    expect(press({ ref: '全体.W' }, '-', { ref: '側板.W' }, 'BS')).toEqual({ text: '全体.W -', cursor: 2 })
    expect(press({ ref: '天地板.W' }, '-', { ref: '{n:nige-1}' }, 'BS').text).toBe('天地板.W -')
  })
  it('消したあとで前後がくっつかない', () => {
    expect(deleteBefore('全体.W -2', 2)).toEqual({ text: '全体.W 2', cursor: 1 })
    expect(unitCount('全体.W 2')).toBe(2)
  })
  it('先頭を消すと、残りの前の空白も消える', () => {
    expect(deleteBefore('1 - 2', 1)).toEqual({ text: '- 2', cursor: 0 })
  })
  it('カーソルが先頭なら何もしない', () => {
    expect(deleteBefore('12', 0)).toEqual({ text: '12', cursor: 0 })
    expect(deleteBefore('', 0)).toEqual({ text: '', cursor: 0 })
  })
  it('全部消す', () => {
    expect(clearAll()).toEqual({ text: '', cursor: 0 })
  })
})

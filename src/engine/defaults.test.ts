import { describe, expect, it } from 'vitest'
import { boardTokenLabel, defaultBoards, defaultNige, defaultSettings, nigeName } from './defaults'
import { DEFAULT_SETTINGS } from './types'

describe('defaultNige（新しい仕事の逃げ）', () => {
  it('逃げ0.5mm と 逃げ1mm の2つ', () => {
    const n = defaultNige()
    expect(n.map((x) => x.value)).toEqual([0.5, 1])
    expect(n.map((x) => nigeName(x.value))).toEqual(['逃げ0.5mm', '逃げ1mm'])
  })
  it('id は nige-0.5 と nige-1（式から id で参照する）', () => {
    expect(defaultNige().map((x) => x.id)).toEqual(['nige-0.5', 'nige-1'])
  })
  it('呼ぶたびに別の配列（仕事どうしで書き換えが漏れない）', () => {
    const a = defaultNige()
    const b = defaultNige()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    a[0].value = 9
    expect(defaultNige()[0].value).toBe(0.5)
  })
})

describe('nigeName（逃げの名前）', () => {
  it('寸法を丸めずに出す（浮動小数の誤差だけ消す）。末尾の .0 は付けない', () => {
    expect(nigeName(0.5)).toBe('逃げ0.5mm')
    expect(nigeName(1)).toBe('逃げ1mm')
    expect(nigeName(2.0)).toBe('逃げ2mm')
    expect(nigeName(1.25)).toBe('逃げ1.25mm')
    expect(nigeName(0.25)).toBe('逃げ0.25mm')
    expect(nigeName(0.1 + 0.2)).toBe('逃げ0.3mm')
  })
})

describe('defaultBoards（新しい仕事の材料）', () => {
  let n = 0
  const newId = (prefix: string) => `${prefix}-${++n}`

  it('メラミン1・ラワン2.5・ラワン4・ラワン5.5 の4つ', () => {
    const b = defaultBoards(newId)
    expect(b.map((x) => [x.material, x.thickness])).toEqual([
      ['メラミン', 1],
      ['ラワン', 2.5],
      ['ラワン', 4],
      ['ラワン', 5.5],
    ])
  })
  it('すべて 3×6（910×1820）・木目は長手方向', () => {
    for (const x of defaultBoards(newId)) {
      expect([x.sizeKind, x.width, x.length, x.grain]).toEqual(['saburoku', 910, 1820, 'long'])
    }
  })
  it('id は newId("board") で作り、すべて別々', () => {
    const prefixes: string[] = []
    const b = defaultBoards((p) => {
      prefixes.push(p)
      return newId(p)
    })
    expect(prefixes).toEqual(['board', 'board', 'board', 'board'])
    expect(new Set(b.map((x) => x.id)).size).toBe(4)
  })
})

describe('boardTokenLabel（式の中の材料の厚みの表示）', () => {
  it('材料名＋厚み＋mm、間に空白なし', () => {
    const [, , lauan4] = defaultBoards((p) => `${p}-x${Math.random()}`)
    expect(boardTokenLabel(lauan4)).toBe('ラワン4mm')
    expect(boardTokenLabel({ material: 'ラワン', thickness: 2.5 })).toBe('ラワン2.5mm')
  })
})

describe('defaultSettings（新しい仕事の設定）', () => {
  it('刃厚3・端切り5・切り代10・縦切り優先・逃げ0.5と1', () => {
    expect(defaultSettings()).toEqual({ ...DEFAULT_SETTINGS, nige: defaultNige() })
  })
  it('呼ぶたびに別の逃げの配列', () => {
    expect(defaultSettings().nige).not.toBe(defaultSettings().nige)
  })
})

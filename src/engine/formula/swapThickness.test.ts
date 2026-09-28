// E-63：材料（フラッシュ）を変えたときの式の厚みの置き換え（仕様書 5.4、architecture.md 15.7）
import { describe, expect, it } from 'vitest'
import { SAMPLE_FLUSH_ID, sampleFlushJob } from '../fixtures/flush'
import { swapThicknessRef } from './usages'

const F22 = 'flush-22'
const tenchi = () => sampleFlushJob(true).parts.find((p) => p.name === '天地板')!.expr

describe('swapThicknessRef', () => {
  it('天地板の H {t:フラッシュ25} をフラッシュ22 に → H が {t:フラッシュ22}・axes は [H]。W・D は変わらない', () => {
    const before = tenchi()
    const r = swapThicknessRef(before, SAMPLE_FLUSH_ID, F22)
    expect(r.expr).toEqual({ W: before.W, H: `{t:${F22}}`, D: before.D })
    expect(r.axes).toEqual(['H'])
    // 元の式は書き換えない
    expect(before.H).toBe(`{t:${SAMPLE_FLUSH_ID}}`)
  })

  it('W・H の両方にあれば [W, H]（W→H→D の順）。式の中の一部でも置き換える', () => {
    const r = swapThicknessRef({ W: `600 - {t:a} * 2`, H: '{t:a}', D: '300' }, 'a', 'b')
    expect(r.expr).toEqual({ W: '600 - {t:b} * 2', H: '{t:b}', D: '300' })
    expect(r.axes).toEqual(['W', 'H'])
  })

  it('{t:from} が無い・from と to が同じ・どちらかが null なら、式はそのままで axes は []', () => {
    const e = tenchi()
    for (const [from, to] of [
      ['other', F22],
      [SAMPLE_FLUSH_ID, SAMPLE_FLUSH_ID],
      [null, F22],
      [SAMPLE_FLUSH_ID, null],
    ] as const) {
      const r = swapThicknessRef(e, from, to)
      expect(r.expr).toEqual(e)
      expect(r.axes).toEqual([])
    }
  })

  it('部材の参照（全体.W）や逃げ（{n:…}）は変わらない', () => {
    const e = { W: '全体.W - {n:nige-1} - {t:a}', H: '{t:ab}', D: '{n:a}' }
    const r = swapThicknessRef(e, 'a', 'b')
    expect(r.expr).toEqual({ W: '全体.W - {n:nige-1} - {t:b}', H: '{t:ab}', D: '{n:a}' })
    expect(r.axes).toEqual(['W'])
  })
})

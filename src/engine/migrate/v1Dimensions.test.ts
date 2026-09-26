import { describe, expect, it } from 'vitest'
import { defaultNige } from '../defaults'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import type { Axis, Job, Part } from '../types'
import { computeV1Dimensions } from './v1Dimensions'

function part(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
  return {
    boardId: LUMBER_18_ID,
    thicknessAxis: null,
    quantity: 1,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
    ...p,
  }
}

function jobOf(parts: Part[]): Job {
  const job = bookshelfJob()
  return { ...job, settings: { ...job.settings, nige: defaultNige() }, parts }
}

type Clr = Map<string, Partial<Record<Axis, number>>>

describe('computeV1Dimensions（以前の版の寸法の計算）', () => {
  it('以前の見本：棚板 W = 天地板.W・逃げ W1 → 仕上がり 863×18×380・木取り 873×18×390・厚みは H', () => {
    const job = bookshelfJob()
    const parts = job.parts.map((p) => (p.name === '棚板' ? { ...p, expr: { ...p.expr, W: '天地板.W' } } : p))
    const r = computeV1Dimensions({ ...job, parts }, new Map([['part-tanaita', { W: 1 }]]) as Clr)
    expect(r.get('part-tanaita')).toEqual({
      finished: { W: 863, H: 18, D: 380 },
      thicknessAxis: 'H',
      cutSize: { W: 873, H: 18, D: 390 },
    })
  })

  it('厚みの自動判定は、自分の逃げを引く前の値で行う（W 19・H 600・D 18・逃げ W1 → 厚みは D、W は 18）', () => {
    const job = jobOf([part({ id: 'p', name: 'P', expr: { W: '19', H: '600', D: '18' } })])
    expect(computeV1Dimensions(job, new Map([['p', { W: 1 }]]) as Clr).get('p')).toEqual({
      finished: { W: 18, H: 600, D: 18 },
      thicknessAxis: 'D',
      cutSize: { W: 28, H: 610, D: 18 },
    })
  })

  it('ほかの部材の値は逃げを引いた後の値（A.H 19・逃げ H1 → B.W = A.H は 18 で、B の厚みは W）', () => {
    const job = jobOf([
      part({ id: 'a', name: 'A', expr: { W: '400', H: '19', D: '300' } }),
      part({ id: 'b', name: 'B', expr: { W: 'A.H', H: '500', D: '300' } }),
    ])
    const r = computeV1Dimensions(job, new Map([['a', { H: 1 }], ['b', { W: 1 }]]) as Clr)
    // A は厚みが決まらない（どの軸も 18 でない）ので、逃げを引く。木取り寸法は出ない
    expect(r.get('a')).toEqual({ finished: { W: 400, H: 18, D: 300 }, thicknessAxis: null, cutSize: null })
    expect(r.get('b')).toEqual({
      finished: { W: 18, H: 500, D: 300 },
      thicknessAxis: 'W',
      cutSize: { W: 18, H: 510, D: 310 },
    })
  })

  it('自分の軸を参照する部材（W = P.H、H 18、逃げ H1）：判定では W 18 なので厚みは W、仕上がりは W 17・H 17', () => {
    const job = jobOf([part({ id: 'p', name: 'P', expr: { W: 'P.H', H: '18', D: '300' } })])
    const r = computeV1Dimensions(job, new Map([['p', { H: 1 }]]) as Clr).get('p')!
    expect(r.thicknessAxis).toBe('W')
    expect(r.finished).toEqual({ W: 17, H: 17, D: 300 })
  })
})

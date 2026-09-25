import { describe, expect, it } from 'vitest'
import { bookshelfJob } from '../fixtures/bookshelf'
import type { Axis, Part } from '../types'
import { computeFinished } from './finished'
import { detectThickness } from './thickness'

const board18 = { thickness: 18 }

function part(extra: Partial<Pick<Part, 'thicknessAxis' | 'quantity'>> = {}) {
  return { thicknessAxis: null, quantity: 1, ...extra }
}

function input(W: number, H: number, D: number): Record<Axis, number> {
  return { W, H, D }
}

describe('detectThickness（厚みの寸法の判定）', () => {
  it('見本で 側板＝W、天地板・棚板＝H、背板＝D が自動で選ばれる', () => {
    const job = bookshelfJob()
    const fin = computeFinished(job)
    const got = Object.fromEntries(
      job.parts
        .filter((p) => p.quantity > 0)
        .map((p) => {
          const board = job.boards.find((b) => b.id === p.boardId) ?? null
          const t = detectThickness(p, board, fin.get(p.id)!.input)
          return [p.name, [t.thicknessAxis, t.thicknessAuto, t.thicknessMismatch]]
        }),
    )
    expect(got).toEqual({
      側板: ['W', true, false],
      天地板: ['H', true, false],
      棚板: ['H', true, false],
      背板: ['D', true, false],
    })
  })

  it('板の面になる2軸は、厚みの寸法以外を W→H→D の順に並べたもの', () => {
    expect(detectThickness(part(), board18, input(18, 700, 600)).faceAxes).toEqual(['H', 'D'])
    expect(detectThickness(part(), board18, input(900, 18, 600)).faceAxes).toEqual(['W', 'D'])
    expect(detectThickness(part(), { thickness: 4 }, input(900, 700, 4)).faceAxes).toEqual(['W', 'H'])
  })

  it('W18 H18 D600 の部材は W が選ばれる', () => {
    expect(detectThickness(part(), board18, input(18, 18, 600))).toMatchObject({
      thicknessAxis: 'W',
      thicknessAuto: true,
      thicknessMismatch: false,
    })
  })

  it('小数第1位で比べる（18.04 は 18 とみなす）', () => {
    expect(detectThickness(part(), board18, input(600, 18.04, 300)).thicknessAxis).toBe('H')
  })

  it('手で D を選んだ W18 H700 D600 の部材は不一致になる', () => {
    expect(detectThickness(part({ thicknessAxis: 'D' }), board18, input(18, 700, 600))).toEqual({
      thicknessAxis: 'D',
      thicknessAuto: false,
      thicknessMismatch: true,
      faceAxes: ['W', 'H'],
    })
  })

  it('手で選んだ軸の値が板の厚みと同じなら不一致にならない（細い桟で W を厚みにする）', () => {
    expect(detectThickness(part({ thicknessAxis: 'H' }), board18, input(18, 18, 600))).toMatchObject({
      thicknessAxis: 'H',
      thicknessMismatch: false,
      faceAxes: ['W', 'D'],
    })
  })

  it('どの軸も厚みと合わない部材は null（不一致の印あり）', () => {
    expect(detectThickness(part(), board18, input(20, 700, 600))).toEqual({
      thicknessAxis: null,
      thicknessAuto: true,
      thicknessMismatch: true,
      faceAxes: null,
    })
  })

  it('枚数0の行（全体）は判定しない（板がなくても不一致にしない）', () => {
    expect(detectThickness(part({ quantity: 0 }), null, input(900, 1800, 400))).toEqual({
      thicknessAxis: null,
      thicknessAuto: true,
      thicknessMismatch: false,
      faceAxes: null,
    })
    expect(detectThickness(part({ quantity: 0 }), board18, input(900, 18, 400)).thicknessAxis).toBeNull()
  })

  it('板が決まっていない部材は判定しない', () => {
    expect(detectThickness(part(), null, input(18, 700, 600))).toMatchObject({
      thicknessAxis: null,
      thicknessMismatch: false,
    })
  })

  it('計算できない軸があって厚みが見つからないときは、不一致とは決めない', () => {
    expect(detectThickness(part(), board18, { W: 20, H: 700 })).toMatchObject({
      thicknessAxis: null,
      thicknessMismatch: false,
    })
  })

  it('計算できない軸があっても、ほかの軸で厚みが見つかればそれを選ぶ', () => {
    expect(detectThickness(part(), board18, { H: 18, D: 600 })).toMatchObject({
      thicknessAxis: 'H',
      thicknessMismatch: false,
      faceAxes: ['W', 'D'],
    })
  })
})

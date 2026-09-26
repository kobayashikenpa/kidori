import { describe, expect, it } from 'vitest'
import { bookshelfJob } from '../fixtures/bookshelf'
import type { Job } from '../types'
import { formulaLabels, unitLabel } from './display'
import { formulaUnits } from './units'

function jobWithLauan4(): Job {
  const job = bookshelfJob()
  job.boards.push({ id: 'b-4', material: 'ラワン', thickness: 4, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
  return job
}

describe('unitLabel（単位の表示名）', () => {
  it('全体.W - {n:nige-1} * 12 → 全体.W・−・逃げ1mm・×・1・2', () => {
    const job = bookshelfJob()
    const expr = '全体.W - {n:nige-1} * 12'
    expect(formulaUnits(expr).map((u) => unitLabel(u, job))).toEqual(['全体.W', '−', '逃げ1mm', '×', '1', '2'])
  })

  it('材料の厚みは ラワン4mm、÷ と + と括弧', () => {
    const job = jobWithLauan4()
    expect(formulaLabels('(600 + {t:b-4}) / 2', job)).toEqual(['(', '6', '0', '0', '+', 'ラワン4mm', ')', '÷', '2'])
  })

  it('消した逃げは（削除した逃げ）、消した材料は（削除した材料）', () => {
    const job = bookshelfJob()
    expect(formulaLabels('{n:gone} + {t:gone}', job)).toEqual(['（削除した逃げ）', '+', '（削除した材料）'])
  })

  it('逃げの寸法を変えると表示名もついてくる', () => {
    const job = bookshelfJob()
    job.settings.nige[1].value = 2
    expect(formulaLabels('天地板.W - {n:nige-1}', job)).toEqual(['天地板.W', '−', '逃げ2mm'])
  })

  it('全角で書いた部材の参照・数字は半角にそろえて見せる', () => {
    expect(formulaLabels('全体．Ｗ－１', bookshelfJob())).toEqual(['全体.W', '−', '1'])
  })

  it('読めないかたまりはそのまま見せる', () => {
    expect(formulaLabels('abc', bookshelfJob())).toEqual(['abc'])
  })
})

import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import type { Part } from '../types'
import { validatePartForSave } from './validate'

function part(p: Partial<Part>): Part {
  return {
    id: 'new',
    name: '桟',
    boardId: LUMBER_18_ID,
    expr: { W: '19', H: '700', D: '600' },
    thicknessAxis: null,
    quantity: 2,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
    ...p,
  }
}

describe('validatePartForSave（部材を保存してよいか）', () => {
  it('見本の部材はすべて保存できる', () => {
    const job = bookshelfJob()
    for (const p of job.parts) expect(validatePartForSave(job, p)).toEqual([])
  })

  it('新しい部材 W19 H700 D600・シナランバー 18（自動）は、厚みが見つからないので保存できない', () => {
    expect(validatePartForSave(bookshelfJob(), part({}))).toEqual([
      '材料の厚み 18 と同じ寸法がありません（W=19・H=700・D=600）。寸法を直すか、厚みの寸法を選んでください',
    ])
  })

  it('手で W を選んだ W19 は「厚みの寸法（W=19）が材料の厚み 18 と合いません」', () => {
    expect(validatePartForSave(bookshelfJob(), part({ thicknessAxis: 'W' }))).toEqual([
      '厚みの寸法（W=19）が材料の厚み 18 と合いません',
    ])
  })

  it('W18 なら保存できる。枚数0の行・材料の無い部材は判定しない', () => {
    const job = bookshelfJob()
    expect(validatePartForSave(job, part({ expr: { W: '18', H: '700', D: '600' } }))).toEqual([])
    expect(validatePartForSave(job, part({ quantity: 0 }))).toEqual([])
    expect(validatePartForSave(job, part({ boardId: null }))).toEqual([])
  })

  it('編集中の部材（すでにある部材の書き換え）は、仕事の中の元の部材の代わりに判定する', () => {
    const job = bookshelfJob()
    const side = job.parts.find((p) => p.name === '側板')!
    expect(validatePartForSave(job, { ...side, expr: { ...side.expr, W: '20' } })).toHaveLength(1)
    // 仕事のデータは変えない
    expect(side.expr.W).toBe('18')
  })

  it('式のエラー（存在しない部材の参照など）は保存を止めない（厚みの不一致だけを返す）', () => {
    expect(validatePartForSave(bookshelfJob(), part({ expr: { W: '無い.W', H: '700', D: '600' } }))).toEqual([])
  })

  it('材料の厚みを式で使った寸法でも判定する（W = {t:…} は 18 と同じ）', () => {
    expect(validatePartForSave(bookshelfJob(), part({ expr: { W: `{t:${LUMBER_18_ID}}`, H: '700', D: '600' } }))).toEqual([])
  })
})

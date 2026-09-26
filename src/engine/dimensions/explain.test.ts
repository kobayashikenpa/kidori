import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import type { Job } from '../types'
import { computeFinished } from './finished'
import { explainDimension, explanationText } from './explain'

function withPart(job: Job, name: string, W: string): Job {
  const base = job.parts[1]
  return { ...job, parts: [...job.parts, { ...base, id: `p-${name}`, name, expr: { W, H: '18', D: '100' } }] }
}

describe('explainDimension（寸法表の内訳）', () => {
  it('天地板.W：全体.W 900 − 側板.W 18 × 2 = 864', () => {
    const e = explainDimension(bookshelfJob(), 'part-tenchiita', 'W')!
    expect(e.pieces).toEqual([
      { kind: 'ref', ref: 'part', label: '全体.W', value: 900 },
      { kind: 'op', text: '−' },
      { kind: 'ref', ref: 'part', label: '側板.W', value: 18 },
      { kind: 'op', text: '×' },
      { kind: 'number', value: 2 },
    ])
    expect(e.result).toBe(864)
    expect(e.errors).toEqual([])
    expect(explanationText(e)).toBe('全体.W 900 − 側板.W 18 × 2 = 864')
  })

  it('棚板.W：天地板.W 864 − 逃げ1 1 = 863（調整寸法は名前＋寸法と値）', () => {
    const e = explainDimension(bookshelfJob(), 'part-tanaita', 'W')!
    expect(e.pieces).toEqual([
      { kind: 'ref', ref: 'part', label: '天地板.W', value: 864 },
      { kind: 'op', text: '−' },
      { kind: 'ref', ref: 'nige', label: '逃げ1', value: 1 },
    ])
    expect(explanationText(e)).toBe('天地板.W 864 − 逃げ1 1 = 863')
  })

  it('数だけの式は 数 = 結果（全体.W：900 = 900）', () => {
    const e = explainDimension(bookshelfJob(), 'part-zentai', 'W')!
    expect(e.pieces).toEqual([{ kind: 'number', value: 900 }])
    expect(explanationText(e)).toBe('900 = 900')
  })

  it('括弧・÷・符号・材料の厚みもそのままの順に並ぶ', () => {
    const job = withPart(bookshelfJob(), '仕切', '(全体.W - {t:' + LUMBER_18_ID + '}) / 2 + -1')
    const e = explainDimension(job, 'p-仕切', 'W')!
    expect(explanationText(e)).toBe('( 全体.W 900 − シナランバー18 18 ) ÷ 2 + − 1 = 440')
    expect(e.pieces[3]).toEqual({ kind: 'ref', ref: 'thickness', label: 'シナランバー18', value: 18 })
  })

  it('小数は小数第1位まで（仕上がり 432.25 は 432.3）。調整寸法の値は丸めない（逃げ0.25 0.25）', () => {
    let job = bookshelfJob()
    job.settings.nige.push({ id: 'n-q', name: '逃げ', value: 0.25 })
    job = withPart(job, 'A', '864.5 / 2')
    job = withPart(job, 'B', 'A.W - {n:n-q}')
    expect(explanationText(explainDimension(job, 'p-A', 'W')!)).toBe('864.5 ÷ 2 = 432.3')
    expect(explanationText(explainDimension(job, 'p-B', 'W')!)).toBe('A.W 432.3 − 逃げ0.25 0.25 = 432')
  })

  it('削除した調整寸法を使う式は結果が null で、エラーを返す', () => {
    const job = bookshelfJob()
    job.settings.nige = job.settings.nige.filter((n) => n.id !== 'nige-1')
    const e = explainDimension(job, 'part-tanaita', 'W')!
    expect(e.result).toBeNull()
    expect(e.pieces[2]).toEqual({ kind: 'ref', ref: 'nige', label: '（削除した逃げ）', value: null })
    expect(e.errors.map((x) => x.kind)).toEqual(['missingNige'])
    expect(explanationText(e)).toBe('天地板.W 864 − （削除した逃げ） ?')
  })

  it('参照先が計算できないと、その参照の値は null で、参照先のエラーを伝える', () => {
    const job = bookshelfJob()
    job.parts[0] = { ...job.parts[0], expr: { ...job.parts[0].expr, W: '900 +' } }
    const e = explainDimension(job, 'part-tenchiita', 'W')!
    expect(e.result).toBeNull()
    expect(e.pieces[0]).toEqual({ kind: 'ref', ref: 'part', label: '全体.W', value: null })
    expect(e.errors[0].from).toEqual({ partId: 'part-zentai', axis: 'W' })
  })

  it('読めない式は項なしでエラーを返す。無い部材は null', () => {
    const job = bookshelfJob()
    job.parts[0] = { ...job.parts[0], expr: { ...job.parts[0].expr, W: '900 +' } }
    const e = explainDimension(job, 'part-zentai', 'W')!
    expect(e.pieces).toEqual([])
    expect(e.errors.map((x) => x.kind)).toEqual(['syntax'])
    expect(explainDimension(job, 'nothing', 'W')).toBeNull()
  })

  it('計算済みの仕上がり寸法を渡しても同じ結果（寸法表で何度も呼ぶとき用）', () => {
    const job = bookshelfJob()
    const fin = computeFinished(job)
    expect(explainDimension(job, 'part-tanaita', 'W', fin)).toEqual(explainDimension(job, 'part-tanaita', 'W'))
  })
})

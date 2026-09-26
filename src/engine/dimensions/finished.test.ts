import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import type { Axis, Job, Part } from '../types'
import { computeFinished } from './finished'

function mkPart(name: string, expr: Partial<Record<Axis, string>>, extra: Partial<Part> = {}): Part {
  return {
    id: `id-${name}`,
    name,
    boardId: LUMBER_18_ID,
    expr: { W: '100', H: '18', D: '100', ...expr },
    thicknessAxis: null,
    quantity: 1,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
    ...extra,
  }
}

function withParts(...extra: Part[]): Job {
  const job = bookshelfJob()
  job.parts.push(...extra)
  return job
}

function finishedOf(job: Job, name: string) {
  const id = job.parts.find((p) => p.name === name)!.id
  return computeFinished(job).get(id)!
}

describe('computeFinished（仕上がり寸法）', () => {
  it('見本：全体 900×1800×400、側板 18×1800×400', () => {
    const job = bookshelfJob()
    expect(finishedOf(job, '全体').finished).toEqual({ W: 900, H: 1800, D: 400 })
    expect(finishedOf(job, '側板').finished).toEqual({ W: 18, H: 1800, D: 400 })
  })

  it('見本：天地板 W=864', () => {
    expect(finishedOf(bookshelfJob(), '天地板').finished).toEqual({ W: 864, H: 18, D: 400 })
  })

  it('見本：棚板 W=863（天地板.W 864 − 逃げ1mm）・D=380。仕上がり寸法 = 式の計算結果', () => {
    const f = finishedOf(bookshelfJob(), '棚板')
    expect(f.input).toEqual({ W: 863, H: 18, D: 380 })
    expect(f.finished).toEqual({ W: 863, H: 18, D: 380 })
    expect(f.errors).toEqual([])
  })

  it('見本：背板 900×1800×4', () => {
    expect(finishedOf(bookshelfJob(), '背板').finished).toEqual({ W: 900, H: 1800, D: 4 })
  })

  it('棚板.W を参照する部材は、逃げを引いた後の 863 を受け取る', () => {
    const job = withParts(mkPart('棚受け', { W: '棚板.W' }))
    expect(finishedOf(job, '棚受け').finished?.W).toBe(863)
  })

  it('全体.W - 1000 は nonPositive', () => {
    const job = withParts(mkPart('X', { W: '全体.W - 1000' }))
    const f = finishedOf(job, 'X')
    expect(f.finished).toBeNull()
    expect(f.errors).toHaveLength(1)
    expect(f.errors[0]).toMatchObject({ partId: 'id-X', axis: 'W', kind: 'nonPositive' })
    expect(f.errors[0].message).toContain('-100')
  })

  it('ちょうど 0 も nonPositive', () => {
    const f = finishedOf(withParts(mkPart('X', { W: '全体.W - 900' })), 'X')
    expect(f.errors[0]).toMatchObject({ kind: 'nonPositive' })
  })

  it('逃げを引いて 0 以下になるときも nonPositive（1 − 逃げ1mm = 0）', () => {
    const f = finishedOf(withParts(mkPart('X', { W: '1 - {n:nige-1}' })), 'X')
    expect(f.errors[0]).toMatchObject({ axis: 'W', kind: 'nonPositive' })
  })

  it('0.1 のように小さくても正なら計算する', () => {
    const f = finishedOf(withParts(mkPart('X', { W: '0.1' })), 'X')
    expect(f.errors).toEqual([])
    expect(f.finished?.W).toBeCloseTo(0.1)
  })

  it('0 除算は divideByZero', () => {
    const f = finishedOf(withParts(mkPart('X', { W: '全体.W / (側板.W - 18)' })), 'X')
    expect(f.errors[0]).toMatchObject({ axis: 'W', kind: 'divideByZero' })
  })

  it('エラーのある寸法を参照している寸法も計算しない（元のエラーを示す）', () => {
    const job = withParts(mkPart('X', { W: '全体.W - 1000' }), mkPart('Y', { W: 'X.W + 10' }), mkPart('Z', { D: 'Y.W' }))
    const y = finishedOf(job, 'Y')
    expect(y.finished).toBeNull()
    expect(y.errors[0]).toMatchObject({ partId: 'id-Y', axis: 'W', kind: 'nonPositive', from: { partId: 'id-X', axis: 'W' } })
    expect(y.errors[0].message).toContain('X.W')
    // 2段先でも、元のエラーの寸法を指す
    const z = finishedOf(job, 'Z')
    expect(z.errors[0]).toMatchObject({ partId: 'id-Z', axis: 'D', from: { partId: 'id-X', axis: 'W' } })
    // ほかの軸は計算できている
    expect(z.input).toMatchObject({ W: 100, H: 18 })
  })

  it('存在しない部材・循環参照のエラーもそのまま返す', () => {
    const job = withParts(mkPart('A', { W: '天板.W' }), mkPart('B', { W: 'C.W' }), mkPart('C', { W: 'B.W' }))
    expect(finishedOf(job, 'A').errors[0]).toMatchObject({ kind: 'unknownRef', refs: ['天板'] })
    expect(finishedOf(job, 'B').errors[0]).toMatchObject({ kind: 'cycle' })
    expect(finishedOf(job, 'C').errors[0]).toMatchObject({ kind: 'cycle' })
  })

  it('逃げは式で引いた軸だけに効く（厚みの軸 H はそのまま 18）', () => {
    const job = bookshelfJob()
    job.parts.find((p) => p.name === '棚板')!.expr.D = '全体.D - 20 - {n:nige-0.5} * 4'
    expect(finishedOf(job, '棚板').finished).toEqual({ W: 863, H: 18, D: 378 })
  })

  it('枚数0の行（板なし）でも逃げを式で引ける。参照している部材も変わる', () => {
    const job = bookshelfJob()
    job.parts[0].expr.W = '900 - {n:nige-1} * 2'
    expect(finishedOf(job, '全体').finished).toEqual({ W: 898, H: 1800, D: 400 })
    expect(finishedOf(job, '天地板').finished?.W).toBe(862)
    expect(finishedOf(job, '棚板').finished?.W).toBe(861)
  })

  it('小数の計算も、丸め誤差なく参照先に渡る', () => {
    const job = withParts(mkPart('X', { W: '100 / 3' }), mkPart('Y', { W: 'X.W * 3' }))
    expect(finishedOf(job, 'Y').finished?.W).toBeCloseTo(100)
  })
})

describe('全角の式', () => {
  it('全角で書いた参照も、全角の名前の部材も計算できる', () => {
    const job = withParts(mkPart('棚板１', { W: '（全体．Ｗ − １００）÷２' }), mkPart('Y', { W: '棚板１.W × 2' }))
    expect(finishedOf(job, '棚板１').finished?.W).toBe(400)
    expect(finishedOf(job, 'Y').finished?.W).toBe(800)
  })
})

describe('自分の寸法を参照する部材', () => {
  // A：W = A.H、H = 18 − 逃げ1mm、D 600
  const selfRef = () => mkPart('A', { W: 'A.H', H: '18 - {n:nige-1}', D: '600' })

  it('自分の別の軸を参照できる（W = A.H = 17）', () => {
    const f = finishedOf(withParts(selfRef()), 'A')
    expect(f.errors).toEqual([])
    expect(f.finished).toEqual({ W: 17, H: 17, D: 600 })
  })

  it('部材の並び順が変わっても同じ結果', () => {
    const job = bookshelfJob()
    job.parts.unshift(selfRef())
    expect(finishedOf(job, 'A').finished).toEqual({ W: 17, H: 17, D: 600 })
  })

  it('ほかの部材を通って自分の別の軸に戻る（P.W = Q.W、Q.W = P.H）のは循環参照ではない', () => {
    const job = withParts(
      mkPart('P', { W: 'Q.W', H: '18', D: '600' }),
      mkPart('Q', { W: 'P.H', H: '18', D: '100' }, { quantity: 0, boardId: null }),
    )
    expect(finishedOf(job, 'P').finished).toEqual({ W: 18, H: 18, D: 600 })
    expect(finishedOf(job, 'Q').errors).toEqual([])
  })

  it('同じ軸に戻るのは循環参照。循環に関係しない軸は計算できる', () => {
    const job = withParts(
      mkPart('P', { W: 'Q.W - {n:nige-1}', H: '18', D: '600' }),
      mkPart('Q', { W: 'P.W', H: '18', D: '100' }, { quantity: 0, boardId: null }),
    )
    const p = finishedOf(job, 'P')
    expect(p.errors.map((e) => [e.axis, e.kind])).toEqual([['W', 'cycle']])
    expect(p.input).toEqual({ H: 18, D: 600 })
  })
})

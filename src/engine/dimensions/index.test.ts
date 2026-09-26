import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import type { Job, Part } from '../types'
import { cutSizeOf } from './cutSize'
import { computeDimensions } from './index'

function byName(job: Job) {
  const r = computeDimensions(job)
  return Object.fromEntries(r.parts.map((p) => [p.name, p]))
}

describe('cutSizeOf（木取り寸法）', () => {
  it('仕様書の例：天板 仕上がり W900×D600・切り代10 → 910×610（厚みの H はそのまま）', () => {
    expect(cutSizeOf({ W: 900, H: 18, D: 600 }, ['W', 'D'], 10)).toEqual({ W: 910, H: 18, D: 610 })
  })

  it('切り代 0 はそのまま', () => {
    expect(cutSizeOf({ W: 900, H: 1800, D: 4 }, ['W', 'H'], 0)).toEqual({ W: 900, H: 1800, D: 4 })
  })

  it('面が決まらない・仕上がりがないときは null', () => {
    expect(cutSizeOf({ W: 900, H: 18, D: 600 }, null, 10)).toBeNull()
    expect(cutSizeOf(null, ['W', 'D'], 10)).toBeNull()
  })
})

describe('computeDimensions（寸法表のまとめ）', () => {
  it('見本の木取り寸法：側板 1810×410、天地板 874×410、棚板 873×390、背板 900×1800', () => {
    const d = byName(bookshelfJob())
    expect(d['側板'].cutSize).toEqual({ W: 18, H: 1810, D: 410 })
    expect(d['天地板'].cutSize).toEqual({ W: 874, H: 18, D: 410 })
    expect(d['棚板'].cutSize).toEqual({ W: 873, H: 18, D: 390 })
    expect(d['背板'].cutSize).toEqual({ W: 900, H: 1800, D: 4 })
  })

  it('見本の仕上がり寸法と枚数・厚みの寸法（docs/tasks.md の表）', () => {
    const d = byName(bookshelfJob())
    const row = (n: string) => [d[n].finished, d[n].thicknessAxis, d[n].faceAxes, d[n].quantity]
    expect(row('全体')).toEqual([{ W: 900, H: 1800, D: 400 }, null, null, 0])
    expect(row('側板')).toEqual([{ W: 18, H: 1800, D: 400 }, 'W', ['H', 'D'], 2])
    expect(row('天地板')).toEqual([{ W: 864, H: 18, D: 400 }, 'H', ['W', 'D'], 2])
    expect(row('棚板')).toEqual([{ W: 863, H: 18, D: 380 }, 'H', ['W', 'D'], 4])
    expect(row('背板')).toEqual([{ W: 900, H: 1800, D: 4 }, 'D', ['W', 'H'], 1])
  })

  it('全体（枚数0）は木取り寸法なし・エラーなし', () => {
    const d = byName(bookshelfJob())
    expect(d['全体'].cutSize).toBeNull()
    expect(d['全体'].errors).toEqual([])
    expect(d['全体'].thicknessMismatch).toBe(false)
  })

  it('使った切り代：部材の上書き（背板 0）と仕事の初期値（10）', () => {
    const d = byName(bookshelfJob())
    expect(d['背板'].allowance).toBe(0)
    expect(d['側板'].allowance).toBe(10)
  })

  it('仕事の切り代を変えると、上書きしていない部材だけ変わる', () => {
    const job = bookshelfJob()
    job.settings.allowance = 5
    const d = byName(job)
    expect(d['側板'].cutSize).toEqual({ W: 18, H: 1805, D: 405 })
    expect(d['背板'].cutSize).toEqual({ W: 900, H: 1800, D: 4 })
  })

  it('入力値と板・名前を部材の並び順で返す。見本はエラーなし', () => {
    const job = bookshelfJob()
    const r = computeDimensions(job)
    expect(r.parts.map((p) => p.partId)).toEqual(job.parts.map((p) => p.id))
    expect(r.errors).toEqual([])
    const tana = r.parts[3]
    expect(tana).toMatchObject({ name: '棚板', boardId: LUMBER_18_ID, input: { W: 864, H: 18, D: 380 } })
  })

  it('参照先を変えると参照している部材も変わる（全体.W 900 → 1200）', () => {
    const job = bookshelfJob()
    job.parts[0].expr.W = '1200'
    const d = byName(job)
    expect(d['天地板'].finished?.W).toBe(1164)
    expect(d['棚板'].cutSize?.W).toBe(1173)
    expect(d['背板'].cutSize?.W).toBe(1200)
  })

  it('エラーのある部材は仕上がり・木取り寸法が null。エラーは全体の一覧にも入る', () => {
    const job = bookshelfJob()
    const bad: Part = { ...job.parts[3], id: 'bad', name: '不良', expr: { W: '天板.W', H: '18', D: '全体.D - 500' } }
    job.parts.push(bad)
    const r = computeDimensions(job)
    const p = r.parts.find((x) => x.partId === 'bad')!
    expect(p.input).toBeNull()
    expect(p.finished).toBeNull()
    expect(p.cutSize).toBeNull()
    expect(p.errors.map((e) => [e.axis, e.kind])).toEqual([
      ['W', 'unknownRef'],
      ['D', 'nonPositive'],
    ])
    expect(r.errors).toEqual(p.errors)
  })

  it('厚みの不一致は印が付き、木取り寸法は面が決まらないので null', () => {
    const job = bookshelfJob()
    job.parts[1].expr.W = '20'
    const d = byName(job)
    expect(d['側板'].thicknessMismatch).toBe(true)
    expect(d['側板'].thicknessAxis).toBeNull()
    expect(d['側板'].cutSize).toBeNull()
  })

  it('手で選んだ厚みの寸法が合わないときは、印を付けたうえで木取り寸法は出す', () => {
    const job = bookshelfJob()
    job.parts[1].thicknessAxis = 'D'
    const d = byName(job)
    expect(d['側板']).toMatchObject({ thicknessAxis: 'D', thicknessAuto: false, thicknessMismatch: true })
    expect(d['側板'].cutSize).toEqual({ W: 28, H: 1810, D: 400 })
  })

  it('存在しない板を指す部材は、板なしとして扱う（厚みは判定しない）', () => {
    const job = bookshelfJob()
    job.parts[1].boardId = 'deleted-board'
    const d = byName(job)
    expect(d['側板'].thicknessAxis).toBeNull()
    expect(d['側板'].thicknessMismatch).toBe(false)
  })
})

describe('自分の寸法を参照する部材（W = A.H、逃げ H1）', () => {
  it('厚みの寸法は W（逃げを引く前の 18 で判定）。仕上がり W は 17 なので不一致の印が付く', () => {
    const job = bookshelfJob()
    job.parts.push({
      ...job.parts[1],
      id: 'a',
      name: 'A',
      expr: { W: 'A.H', H: '18', D: '600' },
      clearance: { H: 1 },
    })
    const r = computeDimensions(job)
    const a = r.parts.find((p) => p.partId === 'a')!
    expect(r.errors).toEqual([])
    expect(a).toMatchObject({
      finished: { W: 17, H: 17, D: 600 },
      thicknessAxis: 'W',
      thicknessMismatch: true,
      faceAxes: ['H', 'D'],
      cutSize: { W: 17, H: 27, D: 610 },
    })
  })
})

describe('式の中の 材料の厚み・逃げ（E-20）', () => {
  /** ラワン 4mm（id b-4）を足した見本 */
  function withLauan4(): Job {
    const job = bookshelfJob()
    job.boards.push({ id: 'b-4', material: 'ラワン', thickness: 4, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
    return job
  }
  const part = (job: Job, name: string) => job.parts.find((p) => p.name === name)!

  it('D = 600 - {t:b-4} * 2 は 592、材料の厚みを 5.5 にすると 589', () => {
    const job = withLauan4()
    part(job, '全体').expr.D = '600 - {t:b-4} * 2'
    expect(byName(job)['全体'].finished!.D).toBe(592)
    job.boards.find((b) => b.id === 'b-4')!.thickness = 5.5
    expect(byName(job)['全体'].finished!.D).toBe(589)
  })

  it('W = 900 - {n:nige-1} は 899、逃げの寸法を 0.5 にすると 899.5', () => {
    const job = bookshelfJob()
    part(job, '全体').expr.W = '900 - {n:nige-1}'
    expect(byName(job)['全体'].finished!.W).toBe(899)
    job.settings.nige.find((n) => n.id === 'nige-1')!.value = 0.5
    expect(byName(job)['全体'].finished!.W).toBe(899.5)
  })

  it('逃げを設定から消すと missingNige、その寸法を参照している部材もエラーになる', () => {
    const job = bookshelfJob()
    part(job, '全体').expr.W = '900 - {n:nige-1}'
    job.settings.nige = job.settings.nige.filter((n) => n.id !== 'nige-1')
    const d = byName(job)
    expect(d['全体'].finished).toBeNull()
    expect(d['全体'].errors).toEqual([
      expect.objectContaining({ axis: 'W', kind: 'missingNige', message: '削除した逃げを使っています' }),
    ])
    // 天地板.W = 全体.W - 側板.W * 2 → 参照先のエラー
    expect(d['天地板'].errors[0]).toMatchObject({
      axis: 'W',
      kind: 'missingNige',
      from: { partId: 'part-zentai', axis: 'W' },
    })
    expect(d['天地板'].errors[0].message).toContain('削除した逃げを使っています')
    expect(d['棚板'].finished).toBeNull()
    // 参照していない部材は計算できる
    expect(d['側板'].finished).toEqual({ W: 18, H: 1800, D: 400 })
  })

  it('材料を消すと、その厚みを使っている寸法は missingBoard', () => {
    const job = withLauan4()
    part(job, '全体').expr.D = '600 - {t:b-4} * 2'
    job.boards = job.boards.filter((b) => b.id !== 'b-4')
    const d = byName(job)
    expect(d['全体'].errors).toEqual([
      expect.objectContaining({ axis: 'D', kind: 'missingBoard', message: '削除した材料の厚みを使っています' }),
    ])
    expect(d['側板'].errors[0]).toMatchObject({ axis: 'D', kind: 'missingBoard', from: { partId: 'part-zentai', axis: 'D' } })
  })

  it('部材が使う材料とは別の材料の厚みも参照できる（見本のシナランバー 18）', () => {
    const job = bookshelfJob()
    part(job, '天地板').expr.W = `全体.W - {t:${LUMBER_18_ID}} * 2`
    expect(byName(job)['天地板'].finished!.W).toBe(864)
  })
})

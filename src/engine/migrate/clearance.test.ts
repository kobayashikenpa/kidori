import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob } from '../fixtures/bookshelf'
import { migrateClearance, type LegacyJob } from './clearance'

/** 以前の版（第1版）の形の見本：棚板 W = 天地板.W・逃げ W1、設定に逃げなし、メモ・チェックなし */
function legacyBookshelf(): LegacyJob {
  const job = bookshelfJob()
  const { nige: _nige, ...settings } = job.settings
  return {
    ...job,
    settings,
    parts: job.parts.map(({ memo: _memo, checks: _checks, ...p }) =>
      p.name === '棚板' ? { ...p, expr: { ...p.expr, W: '天地板.W' }, clearance: { W: 1 } } : { ...p, clearance: {} },
    ),
  }
}

function ids() {
  let n = 0
  return () => `nige-new-${++n}`
}

function find<P extends { name: string }>(job: { parts: P[] }, name: string): P {
  return job.parts.find((p) => p.name === name)!
}

describe('migrateClearance（以前の版の部材ごとの逃げを移し替える）', () => {
  it('見本：設定の逃げは 0.5・1 の2つ、棚板 W は 天地板.W - {n:nige-1}、仕上がり 863 のまま', () => {
    const job = migrateClearance(legacyBookshelf(), ids())
    expect(job.settings.nige).toEqual([
      { id: 'nige-0.5', value: 0.5 },
      { id: 'nige-1', value: 1 },
    ])
    expect(find(job, '棚板').expr.W).toBe('天地板.W - {n:nige-1}')
    const d = computeDimensions(job)
    expect(d.errors).toEqual([])
    expect(d.parts.find((p) => p.name === '棚板')!.finished).toEqual({ W: 863, H: 18, D: 380 })
    expect(d.parts.find((p) => p.name === '棚板')!.cutSize).toEqual({ W: 873, H: 18, D: 390 })
  })

  it('移し替えた見本は、今の見本と同じ内容になる（clearance は残らない）', () => {
    expect(migrateClearance(legacyBookshelf(), ids())).toEqual(bookshelfJob())
  })

  it('逃げ W2 の部材は 逃げ2mm が足され、式が括弧つきになる', () => {
    const legacy = legacyBookshelf()
    const tenchi = find(legacy, '天地板')
    tenchi.expr.W = '全体.W - 36'
    tenchi.clearance = { W: 2 }
    const job = migrateClearance(legacy, ids())
    expect(job.settings.nige).toEqual([
      { id: 'nige-0.5', value: 0.5 },
      { id: 'nige-1', value: 1 },
      { id: 'nige-new-1', value: 2 },
    ])
    expect(find(job, '天地板').expr.W).toBe('(全体.W - 36) - {n:nige-new-1}')
    expect(computeDimensions(job).parts.find((p) => p.name === '天地板')!.finished!.W).toBe(862)
  })

  it('足す逃げは値の小さい順。同じ値（小数第1位で比較）は1つにまとめる', () => {
    const legacy = legacyBookshelf()
    ;(find(legacy, '側板')).clearance = { D: 3 }
    ;(find(legacy, '天地板')).clearance = { D: 2, W: 3.04 }
    const job = migrateClearance(legacy, ids())
    expect(job.settings.nige.map((n) => [n.id, n.value])).toEqual([
      ['nige-0.5', 0.5],
      ['nige-1', 1],
      ['nige-new-1', 2],
      ['nige-new-2', 3],
    ])
    expect(find(job, '側板').expr.D).toBe('全体.D - {n:nige-new-2}')
    expect(find(job, '天地板').expr.W).toBe('(全体.W - 側板.W * 2) - {n:nige-new-2}')
  })

  it('厚みの寸法の軸に入っていた逃げは式に足さない（棚板 H 18 は厚み）', () => {
    const legacy = legacyBookshelf()
    ;(find(legacy, '棚板')).clearance = { W: 1, H: 1, D: 0.5 }
    const job = migrateClearance(legacy, ids())
    expect(find(job, '棚板').expr).toEqual({ W: '天地板.W - {n:nige-1}', H: '18', D: '(全体.D - 20) - {n:nige-0.5}' })
  })

  it('手で選んだ厚みの軸には足さない', () => {
    const legacy = legacyBookshelf()
    const p = find(legacy, '側板')
    p.thicknessAxis = 'D'
    p.clearance = { D: 1, W: 1 }
    const job = migrateClearance(legacy, ids())
    expect(find(job, '側板').expr).toMatchObject({ W: '18 - {n:nige-1}', D: '全体.D' })
  })

  it('厚みが決まらない部材（枚数0の全体）は3軸とも引く（以前と同じ）', () => {
    const legacy = legacyBookshelf()
    ;(find(legacy, '全体')).clearance = { W: 1, H: 1 }
    const job = migrateClearance(legacy, ids())
    expect(find(job, '全体').expr).toEqual({ W: '900 - {n:nige-1}', H: '1800 - {n:nige-1}', D: '400' })
  })

  it('式が空の軸はそのまま（エラーのまま）。0 や負の逃げは無視する', () => {
    const legacy = legacyBookshelf()
    const p = find(legacy, '背板')
    p.expr.W = ''
    p.clearance = { W: 1, H: 0, D: -1 }
    const job = migrateClearance(legacy, ids())
    expect(find(job, '背板').expr).toEqual({ W: '', H: '全体.H', D: '4' })
  })

  it('移し替えた結果をもう一度移し替えても変わらない', () => {
    const once = migrateClearance(legacyBookshelf(), ids())
    const twice = migrateClearance(once, ids())
    expect(twice).toEqual(once)
  })

  it('設定にすでに逃げがあれば、それを使う（初期の逃げを足さない）', () => {
    const legacy = legacyBookshelf()
    legacy.settings.nige = [{ id: 'my-1', value: 1 }]
    const job = migrateClearance(legacy, ids())
    expect(job.settings.nige).toEqual([{ id: 'my-1', value: 1 }])
    expect(find(job, '棚板').expr.W).toBe('天地板.W - {n:my-1}')
  })

  it('メモ・チェックが無ければ足し、あればそのまま', () => {
    const legacy = legacyBookshelf()
    ;(legacy.parts[1]).memo = '穴あけ'
    const job = migrateClearance(legacy, ids())
    expect(job.parts[1].memo).toBe('穴あけ')
    expect(job.parts[0].memo).toBe('')
    expect(job.parts[0].checks).toEqual({ finished: false, cut: false })
  })

  it('元のデータを書き換えない', () => {
    const legacy = legacyBookshelf()
    const before = JSON.stringify(legacy)
    migrateClearance(legacy, ids())
    expect(JSON.stringify(legacy)).toBe(before)
  })

  it('全角で書いた式も括弧の要否を判断できる', () => {
    const legacy = legacyBookshelf()
    const p = find(legacy, '側板')
    p.expr.D = '４００'
    p.clearance = { D: 1 }
    expect(find(migrateClearance(legacy, ids()), '側板').expr.D).toBe('４００ - {n:nige-1}')
  })
})

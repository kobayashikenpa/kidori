import { describe, expect, it } from 'vitest'
import { nigeName } from '../defaults'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import type { Axis } from '../types'
import { migrateClearance, migrateClearanceChecked, type LegacyJob, type LegacyPart } from './clearance'
import { computeV1Dimensions } from './v1Dimensions'

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

  it('足す逃げは値の小さい順。同じ値だけを1つにまとめる（3 と 3.04 は別の逃げ）', () => {
    const legacy = legacyBookshelf()
    ;(find(legacy, '側板')).clearance = { D: 3 }
    ;(find(legacy, '天地板')).clearance = { D: 2, W: 3.04 }
    ;(find(legacy, '背板')).clearance = { W: 3 }
    const job = migrateClearance(legacy, ids())
    expect(job.settings.nige.map((n) => [n.id, n.value])).toEqual([
      ['nige-0.5', 0.5],
      ['nige-1', 1],
      ['nige-new-1', 2],
      ['nige-new-2', 3],
      ['nige-new-3', 3.04],
    ])
    expect(find(job, '側板').expr.D).toBe('全体.D - {n:nige-new-2}')
    expect(find(job, '背板').expr.W).toBe('全体.W - {n:nige-new-2}')
    expect(find(job, '天地板').expr.W).toBe('(全体.W - 側板.W * 2) - {n:nige-new-3}')
    expect(computeDimensions(job).parts.find((p) => p.name === '天地板')!.finished!.W).toBeCloseTo(860.96, 9)
  })

  it('逃げの値は丸めない：0.25 は 0.25 のまま（名前は 逃げ0.25mm）。0.25 と 0.3 は別の逃げ', () => {
    const legacy = legacyBookshelf()
    ;(find(legacy, '側板')).clearance = { D: 0.25 }
    ;(find(legacy, '背板')).clearance = { W: 0.3, H: 0.25 }
    const { job, changed } = migrateClearanceChecked(legacy, ids())
    expect(job.settings.nige.map((n) => n.value)).toEqual([0.5, 1, 0.25, 0.3])
    expect(nigeName(0.25)).toBe('逃げ0.25mm')
    const d = computeDimensions(job)
    expect(d.parts.find((p) => p.name === '側板')!.finished!.D).toBe(399.75)
    expect(d.parts.find((p) => p.name === '背板')!.finished).toEqual({ W: 899.7, H: 1799.75, D: 4 })
    expect(changed).toEqual([])
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

  // ---------- 以前の版の計算と寸法が変わらないこと ----------

  function legacyJob(parts: LegacyPart[]): LegacyJob {
    const { settings, ...rest } = legacyBookshelf()
    return { ...rest, settings, parts }
  }

  function lp(p: Partial<LegacyPart> & Pick<LegacyPart, 'id' | 'name' | 'expr'>): LegacyPart {
    return { boardId: LUMBER_18_ID, thicknessAxis: null, quantity: 1, grain: 'any', allowance: null, ...p }
  }

  /** 以前の版の計算（部材ごとの逃げ）と、移し替えた後の今の計算の、部材ごとの寸法・厚みの軸・木取り寸法 */
  function beforeAfter(legacy: LegacyJob) {
    const { job, changed } = migrateClearanceChecked(legacy, ids())
    const clr = new Map(legacy.parts.map((p) => [p.id, p.clearance ?? {}] as [string, Partial<Record<Axis, number>>]))
    const v1 = computeV1Dimensions(migrateClearance({ ...legacy, parts: legacy.parts.map(({ clearance: _c, ...p }) => p) }, ids()), clr)
    const now = computeDimensions(job)
    const before = legacy.parts.map((p) => ({ name: p.name, ...v1.get(p.id)! }))
    const after = now.parts.map((d) => ({
      name: d.name,
      finished: d.finished,
      thicknessAxis: d.thicknessAxis,
      cutSize: d.cutSize,
    }))
    return { job, changed, before, after }
  }

  it('見本（棚板 逃げ W1）は、以前の計算と寸法・厚みの軸・木取り寸法がすべて同じ', () => {
    const { before, after, changed } = beforeAfter(legacyBookshelf())
    expect(after).toEqual(before)
    expect(changed).toEqual([])
  })

  it('W 19・H 600・D 18・逃げ W1（材料 18）：式は 19 - 逃げ1mm、厚みは D に固定し、以前と同じ（W 18・厚み D・木取り 28×610）', () => {
    const legacy = legacyJob([lp({ id: 'p', name: 'P', expr: { W: '19', H: '600', D: '18' }, clearance: { W: 1 } })])
    const { job, before, after, changed } = beforeAfter(legacy)
    expect(find(job, 'P').expr.W).toBe('19 - {n:nige-1}')
    expect(find(job, 'P').thicknessAxis).toBe('D')
    expect(before).toEqual([{ name: 'P', finished: { W: 18, H: 600, D: 18 }, thicknessAxis: 'D', cutSize: { W: 28, H: 610, D: 18 } }])
    expect(after).toEqual(before)
    expect(changed).toEqual([])
  })

  it('A（W400・H19・D300・逃げ H1）と B（W = A.H・H500・D300・逃げ W1）：B は厚みの W に逃げを引かず、以前と同じ', () => {
    const legacy = legacyJob([
      lp({ id: 'a', name: 'A', expr: { W: '400', H: '19', D: '300' }, clearance: { H: 1 } }),
      lp({ id: 'b', name: 'B', expr: { W: 'A.H', H: '500', D: '300' }, clearance: { W: 1 } }),
    ])
    const { job, before, after, changed } = beforeAfter(legacy)
    expect(find(job, 'A').expr.H).toBe('19 - {n:nige-1}')
    expect(find(job, 'B').expr.W).toBe('A.H')
    // 仕上がり寸法は2つとも以前と同じ
    expect(after.map((a) => a.finished)).toEqual(before.map((b) => b.finished))
    // B は厚みの軸・木取り寸法も同じ
    expect(after[1]).toEqual(before[1])
    expect(after[1]).toEqual({ name: 'B', finished: { W: 18, H: 500, D: 300 }, thicknessAxis: 'W', cutSize: { W: 18, H: 510, D: 310 } })
    // A は以前は厚みが決まらなかった（どの軸も 18 でない）が、今は H が 18 になり厚みが H に決まる。
    // 「厚みが決まらない」は今の形では残せないので、変わった部材として知らせる
    expect(before[0]!.thicknessAxis).toBeNull()
    expect(after[0]!.thicknessAxis).toBe('H')
    expect(changed).toEqual([{ partId: 'a', name: 'A' }])
  })

  it('手で選んだ厚みの軸はそのまま（固定し直さない）', () => {
    const legacy = legacyJob([
      lp({ id: 'p', name: 'P', expr: { W: '19', H: '600', D: '18' }, thicknessAxis: 'D', clearance: { W: 1 } }),
    ])
    const { job, before, after, changed } = beforeAfter(legacy)
    expect(find(job, 'P').thicknessAxis).toBe('D')
    expect(after).toEqual(before)
    expect(changed).toEqual([])
  })
})

// 仕上がり寸法：計算順に式を計算する。仕上がり寸法 = 式の計算結果（逃げは式の中で引く）。0 以下はエラー
import { evaluate } from '../formula/evaluate'
import { normalizePartName } from '../formula/tokenize'
import { round1 } from '../round'
import { AXES, type Axis, type DimensionError, type Job } from '../types'
import { dimKey, resolve, type DimRef } from './resolve'

type Value = { ok: true; value: number } | { ok: false; error: DimensionError }

export interface FinishedDims {
  /** 軸ごとの仕上がり寸法（式の計算結果）。計算できない軸は入らない */
  finished: Partial<Record<Axis, number>>
  /** W・H・D の順 */
  errors: DimensionError[]
}

/**
 * 全部材の仕上がり寸法を求める。キーは部材の id。
 * - 参照先の値は、その部材の仕上がり寸法（式の計算結果）
 * - 材料の厚み {t:…} は job.boards の厚み、逃げ {n:…} は job.settings.nige の寸法
 * - エラーのある寸法を参照している寸法は計算せず、元のエラーの寸法を from で示す
 */
export function computeFinished(job: Pick<Job, 'parts' | 'boards' | 'settings'>): Map<string, FinishedDims> {
  const res = resolve(job.parts)
  const partById = new Map(job.parts.map((p) => [p.id, p]))
  const boardById = new Map(job.boards.map((b) => [b.id, b]))
  const nigeById = new Map(job.settings.nige.map((n) => [n.id, n.value]))
  // 全角・半角をそろえた部材名 → id（式の中の参照は、そろえた名前で出てくる）
  const idByName = new Map<string, string>()
  for (const p of job.parts) {
    const key = normalizePartName(p.name)
    if (!idByName.has(key)) idByName.set(key, p.id)
  }
  const ownErrors = new Map<string, DimensionError[]>()
  for (const e of res.errors) {
    const key = dimKey(e.partId, e.axis)
    ownErrors.set(key, [...(ownErrors.get(key) ?? []), e])
  }

  const memo = new Map<string, Value>()
  const label = (d: DimRef) => `${partById.get(d.partId)!.name}.${d.axis}`

  /** 参照先のエラーを、参照している寸法のエラーとして伝える */
  const propagate = (d: DimRef, depError: DimensionError): DimensionError => {
    const origin = depError.from ?? { partId: depError.partId, axis: depError.axis }
    const originError = ownErrors.get(dimKey(origin.partId, origin.axis))?.[0] ?? depError
    return {
      partId: d.partId,
      axis: d.axis,
      kind: originError.kind,
      message: `参照している ${label(origin)} が計算できません（${originError.message}）`,
      ...(originError.refs ? { refs: originError.refs } : {}),
      from: origin,
    }
  }

  const setOwnError = (d: DimRef, error: DimensionError): Value => {
    ownErrors.set(dimKey(d.partId, d.axis), [error])
    return { ok: false, error }
  }

  /** 仕上がり寸法。循環している寸法は resolve でエラーになっているので、ここで無限に辿ることはない */
  function finishedOf(d: DimRef): Value {
    const key = dimKey(d.partId, d.axis)
    const cached = memo.get(key)
    if (cached) return cached
    const result = compute(d, key)
    memo.set(key, result)
    return result
  }

  function compute(d: DimRef, key: string): Value {
    const own = ownErrors.get(key)
    if (own) return { ok: false, error: own[0] }
    const node = res.nodes.get(key)!
    // 参照先の値を先に計算する（エラーがあればそのエラーを伝える）
    const values = new Map<string, number>()
    for (const dep of node.deps) {
      const v = finishedOf(dep)
      if (!v.ok) return { ok: false, error: propagate(d, v.error) }
      values.set(dimKey(dep.partId, dep.axis), v.value)
    }
    const r = evaluate(node.ast!, {
      ref: (part, axis) => {
        const id = idByName.get(part)
        return id === undefined ? null : (values.get(dimKey(id, axis)) ?? null)
      },
      thickness: (boardId) => boardById.get(boardId)?.thickness ?? null,
      nige: (nigeId) => nigeById.get(nigeId) ?? null,
    })
    if (!r.ok) return setOwnError(d, { partId: d.partId, axis: d.axis, kind: r.error.kind, message: r.error.message })
    if (round1(r.value) <= 0) {
      return setOwnError(d, {
        partId: d.partId,
        axis: d.axis,
        kind: 'nonPositive',
        message: `計算結果が 0 以下になります（${round1(r.value)}）`,
      })
    }
    return { ok: true, value: r.value }
  }

  for (const d of res.order) finishedOf(d)

  const out = new Map<string, FinishedDims>()
  for (const p of job.parts) {
    const values: Partial<Record<Axis, number>> = {}
    const errors: DimensionError[] = []
    for (const axis of AXES) {
      const f = finishedOf({ partId: p.id, axis })
      if (f.ok) values[axis] = f.value
      else errors.push(...(ownErrors.get(dimKey(p.id, axis)) ?? [f.error]))
    }
    out.set(p.id, { finished: values, errors })
  }
  return out
}

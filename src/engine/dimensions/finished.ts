// 仕上がり寸法：計算順に式を計算し、逃げを引く（厚みの寸法には引かない）。0 以下はエラー
import { evaluate } from '../formula/evaluate'
import { round1 } from '../round'
import { AXES, type Axis, type DimensionError, type Job, type Part } from '../types'
import { dimKey, resolve, type DimRef } from './resolve'
import { pickThicknessAxis } from './thickness'

type Value = { ok: true; value: number } | { ok: false; error: DimensionError }

export interface FinishedDims {
  /** 軸ごとの入力値（式の計算結果）。計算できない軸は入らない */
  input: Partial<Record<Axis, number>>
  /** 3軸とも計算できたときの入力値 */
  inputAll: Record<Axis, number> | null
  /** 3軸とも計算できたときの仕上がり寸法（入力 − 逃げ） */
  finished: Record<Axis, number> | null
  /** W・H・D の順 */
  errors: DimensionError[]
}

/**
 * 全部材の入力値と仕上がり寸法を求める。キーは部材の id。
 * - 参照先の値は、逃げを引いた後の仕上がり寸法
 * - 逃げは厚みの寸法（thickness.ts で判定）以外の軸に引く。厚みの寸法が決まらない部材は、指定された逃げをそのまま引く
 * - エラーのある寸法を参照している寸法は計算せず、元のエラーの寸法を from で示す
 */
export function computeFinished(job: Pick<Job, 'parts' | 'boards'>): Map<string, FinishedDims> {
  const res = resolve(job.parts)
  const partById = new Map(job.parts.map((p) => [p.id, p]))
  const boardById = new Map(job.boards.map((b) => [b.id, b]))
  const idByName = new Map<string, string>()
  for (const p of job.parts) if (!idByName.has(p.name)) idByName.set(p.name, p.id)
  const ownErrors = new Map<string, DimensionError[]>()
  for (const e of res.errors) {
    const key = dimKey(e.partId, e.axis)
    ownErrors.set(key, [...(ownErrors.get(key) ?? []), e])
  }

  const inputMemo = new Map<string, Value>()
  const finishedMemo = new Map<string, Value>()
  const inProgress = new Set<string>()

  const label = (d: DimRef) => `${partById.get(d.partId)!.name}.${d.axis}`

  const ownError = (d: DimRef, kind: DimensionError['kind'], message: string): Value => {
    const error: DimensionError = { partId: d.partId, axis: d.axis, kind, message }
    ownErrors.set(dimKey(d.partId, d.axis), [error])
    return { ok: false, error }
  }

  /** 参照先のエラーを、参照している寸法のエラーとして伝える */
  const propagate = (d: DimRef, dep: DimRef, depError: DimensionError): Value => {
    const origin = depError.from ?? dep
    const originError = ownErrors.get(dimKey(origin.partId, origin.axis))?.[0] ?? depError
    return {
      ok: false,
      error: {
        partId: d.partId,
        axis: d.axis,
        kind: originError.kind,
        message: `参照している ${label(origin)} が計算できません（${originError.message}）`,
        ...(originError.refs ? { refs: originError.refs } : {}),
        from: origin,
      },
    }
  }

  function inputOf(d: DimRef): Value {
    const key = dimKey(d.partId, d.axis)
    const memo = inputMemo.get(key)
    if (memo) return memo
    const own = ownErrors.get(key)
    if (own) return { ok: false, error: own[0] }
    if (inProgress.has(key)) {
      // 逃げと厚みの判定が互いに相手を必要とする、まれな場合
      return ownError(d, 'cycle', `循環参照になっています（${label(d)} の厚みの判定と逃げ）`)
    }
    inProgress.add(key)
    const node = res.nodes.get(key)!
    let result: Value | null = null
    for (const dep of node.deps) {
      const v = finishedOf(dep)
      if (!v.ok) {
        result = propagate(d, dep, v.error)
        break
      }
    }
    if (!result) {
      const r = evaluate(node.ast!, (part, axis) => {
        const v = finishedOf({ partId: idByName.get(part)!, axis })
        return v.ok ? v.value : null
      })
      result = r.ok ? r : ownError(d, r.error.kind, r.error.message)
    }
    inProgress.delete(key)
    inputMemo.set(key, result)
    return result
  }

  function isThicknessAxis(part: Part, axis: Axis): boolean {
    const board = part.boardId ? (boardById.get(part.boardId) ?? null) : null
    const picked = pickThicknessAxis(part, board, (a) => {
      const v = inputOf({ partId: part.id, axis: a })
      return v.ok ? v.value : null
    })
    return picked.axis === axis
  }

  function finishedOf(d: DimRef): Value {
    const key = dimKey(d.partId, d.axis)
    const memo = finishedMemo.get(key)
    if (memo) return memo
    const input = inputOf(d)
    let result: Value = input
    if (input.ok) {
      const part = partById.get(d.partId)!
      const clearance = part.clearance[d.axis] ?? 0
      // 逃げがなければ厚みの判定はいらない（余計な依存を作らない）
      const value = clearance !== 0 && !isThicknessAxis(part, d.axis) ? input.value - clearance : input.value
      result =
        round1(value) <= 0
          ? ownError(d, 'nonPositive', `計算結果が 0 以下になります（${round1(value)}）`)
          : { ok: true, value }
    }
    finishedMemo.set(key, result)
    return result
  }

  for (const d of res.order) finishedOf(d)

  const out = new Map<string, FinishedDims>()
  for (const p of job.parts) {
    const input: Partial<Record<Axis, number>> = {}
    const finished: Partial<Record<Axis, number>> = {}
    const errors: DimensionError[] = []
    for (const axis of AXES) {
      const key = dimKey(p.id, axis)
      const i = inputOf({ partId: p.id, axis })
      if (i.ok) input[axis] = i.value
      const f = finishedOf({ partId: p.id, axis })
      if (f.ok) finished[axis] = f.value
      else errors.push(...(ownErrors.get(key) ?? [f.error]))
    }
    out.set(p.id, {
      input,
      inputAll: isComplete(input) ? input : null,
      finished: isComplete(finished) ? finished : null,
      errors,
    })
  }
  return out
}

function isComplete(r: Partial<Record<Axis, number>>): r is Record<Axis, number> {
  return AXES.every((a) => r[a] !== undefined)
}

// 仕上がり寸法：計算順に式を計算し、逃げを引く（厚みの寸法には引かない）。0 以下はエラー
import { evaluate } from '../formula/evaluate'
import { normalizePartName } from '../formula/tokenize'
import { round1 } from '../round'
import { AXES, type Axis, type DimensionError, type Job, type Part } from '../types'
import { dimKey, resolve, type DimRef } from './resolve'
import { pickThicknessAxis } from './thickness'

type Value = { ok: true; value: number } | { ok: false; error: DimensionError }

type Thickness =
  | { ok: true; axis: Axis | null; used: Partial<Record<Axis, number>> }
  | { ok: false; error: DimensionError }

export interface FinishedDims {
  /** 軸ごとの入力値（式の計算結果）。計算できない軸は入らない */
  input: Partial<Record<Axis, number>>
  /** 3軸とも計算できたときの入力値 */
  inputAll: Record<Axis, number> | null
  /** 3軸とも計算できたときの仕上がり寸法（入力 − 逃げ） */
  finished: Record<Axis, number> | null
  /**
   * 厚みの寸法の自動判定に使った値（その部材自身の逃げを引く前の値）。W から順に、判定に必要だった軸だけ入る。
   * 手で選んだ・判定しない部材では空。detectThickness に渡すと、ここでの判定と同じ軸が選ばれる
   */
  thicknessInput: Partial<Record<Axis, number>>
  /** W・H・D の順 */
  errors: DimensionError[]
}

/** 厚みの判定の途中で循環が見つかったときに、判定を打ち切るための印 */
class AbortThickness {
  readonly error: DimensionError
  constructor(error: DimensionError) {
    this.error = error
  }
}

/**
 * 全部材の入力値と仕上がり寸法を求める。キーは部材の id。
 * - 参照先の値は、逃げを引いた後の仕上がり寸法
 * - 逃げは厚みの寸法以外の軸に引く。厚みの寸法が決まらない部材は、指定された逃げをそのまま引く
 * - 厚みの自動判定は、その部材自身の逃げを引く前の値で行う（自分の軸への参照も逃げを引く前の値。
 *   例：W = A.H、H 18、逃げ H1 → W は判定では 18 なので厚みは W、仕上がりは W 17・H 17）。
 *   判定用の値は仕上がり寸法の計算結果とは別に持ち、混ぜない
 * - ほかの部材を通って、自分の厚みの判定が自分の逃げを引いた値に戻ってくる場合は循環参照（cycle）
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
  const keyIndex = new Map([...res.nodes.keys()].map((k, i) => [k, i]))
  const ownErrors = new Map<string, DimensionError[]>()
  for (const e of res.errors) {
    const key = dimKey(e.partId, e.axis)
    ownErrors.set(key, [...(ownErrors.get(key) ?? []), e])
  }

  const inputMemo = new Map<string, Value>()
  const finishedMemo = new Map<string, Value>()
  const thicknessMemo = new Map<string, Thickness>()

  /** 計算中の仕上がり寸法（呼び出しの順） */
  const stack: string[] = []
  const onStack = new Set<string>()
  /** 厚みの判定を待っている仕上がり寸法 */
  const waitingThickness = new Set<string>()
  /** 厚みの判定中の部材 → 判定を始めた仕上がり寸法 */
  const thicknessOwner = new Map<string, string>()

  const label = (d: DimRef) => `${partById.get(d.partId)!.name}.${d.axis}`
  const refOf = (key: string): DimRef => {
    const n = res.nodes.get(key)!
    return { partId: n.partId, axis: n.axis }
  }
  const originOf = (e: DimensionError): DimRef => e.from ?? { partId: e.partId, axis: e.axis }

  const cycleError = (d: DimRef): DimensionError => ({
    partId: d.partId,
    axis: d.axis,
    kind: 'cycle',
    message: `循環参照になっています（${label(d)} の逃げを引くかどうか（厚みの判定）が、${label(d)} 自身の値に戻ってきます）`,
    refs: [partById.get(d.partId)!.name],
  })

  /**
   * 計算中の寸法 fromKey に戻ってきたとき：そこから先の呼び出しのうち、厚みの判定を待っている寸法を
   * 循環の元とする（部材の並び順で最初のもの）。どこから計算を始めても同じ元になる
   */
  const loopError = (fromKey: string): DimensionError => {
    const segment = stack.slice(stack.indexOf(fromKey)).filter((k) => waitingThickness.has(k))
    segment.sort((a, b) => keyIndex.get(a)! - keyIndex.get(b)!)
    return cycleError(refOf(segment[0] ?? fromKey))
  }

  /** 参照先のエラーを、参照している寸法のエラーとして伝える */
  const propagate = (d: DimRef, depError: DimensionError): DimensionError => {
    const origin = originOf(depError)
    if (origin.partId === d.partId && origin.axis === d.axis) return depError
    // 元の寸法のエラーがまだ決まっていないのは、計算中に循環が見つかったときだけ
    const originError =
      ownErrors.get(dimKey(origin.partId, origin.axis))?.[0] ?? (depError.from ? cycleError(origin) : depError)
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

  /** 式を計算する。自分の部材への参照は selfValue、ほかの部材への参照は仕上がり寸法 */
  function evaluateNode(d: DimRef, selfValue: (axis: Axis) => Value): Value {
    const key = dimKey(d.partId, d.axis)
    const own = ownErrors.get(key)
    if (own) return { ok: false, error: own[0] }
    const node = res.nodes.get(key)!
    // 参照先の値を先に計算する（エラーがあればそのエラーを伝える）
    const values = new Map<string, number>()
    for (const dep of node.deps) {
      const v = dep.partId === d.partId ? selfValue(dep.axis) : finishedOf(dep)
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
    return r.ok ? r : { ok: false, error: { partId: d.partId, axis: d.axis, kind: r.error.kind, message: r.error.message } }
  }

  /** 入力値（式の計算結果）。参照先は仕上がり寸法 */
  function inputOf(d: DimRef): Value {
    const key = dimKey(d.partId, d.axis)
    const memo = inputMemo.get(key)
    if (memo) return memo
    const result = evaluateNode(d, (axis) => finishedOf({ partId: d.partId, axis }))
    // 自分の式のエラー（0 除算など）は、この寸法のエラーとして覚える
    if (!result.ok && !result.error.from && !ownErrors.has(key)) setOwnError(d, result.error)
    inputMemo.set(key, result)
    return result
  }

  /** 厚みの判定用の値：自分の部材への参照も、逃げを引く前の値を使う。結果は覚えない（仕上がり寸法と混ぜない） */
  function thicknessValueOf(part: Part, axis: Axis, seen: Map<Axis, Value>): Value {
    const cached = seen.get(axis)
    if (cached) return cached
    const d = { partId: part.id, axis }
    const node = res.nodes.get(dimKey(part.id, axis))!
    const selfRef = node.deps.some((dep) => dep.partId === part.id)
    // 自分の部材を参照していなければ、入力値そのもの
    const v = selfRef ? evaluateNode(d, (a) => thicknessValueOf(part, a, seen)) : inputOf(d)
    seen.set(axis, v)
    return v
  }

  function thicknessOf(part: Part, ownerKey: string): Thickness {
    const memo = thicknessMemo.get(part.id)
    if (memo) return memo
    const running = thicknessOwner.get(part.id)
    if (running !== undefined) return { ok: false, error: loopError(running) }

    const board = part.boardId ? (boardById.get(part.boardId) ?? null) : null
    thicknessOwner.set(part.id, ownerKey)
    const used: Partial<Record<Axis, number>> = {}
    const seen = new Map<Axis, Value>()
    let result: Thickness
    try {
      const picked = pickThicknessAxis(part, board, (axis) => {
        const v = thicknessValueOf(part, axis, seen)
        if (v.ok) {
          used[axis] = v.value
          return v.value
        }
        // 計算中の寸法に戻ってきた（循環）なら打ち切る。ふつうのエラーの軸は飛ばす
        const origin = originOf(v.error)
        if (onStack.has(dimKey(origin.partId, origin.axis))) throw new AbortThickness(v.error)
        return null
      })
      result = { ok: true, axis: picked.axis, used }
    } catch (e) {
      if (!(e instanceof AbortThickness)) throw e
      result = { ok: false, error: e.error }
    } finally {
      thicknessOwner.delete(part.id)
    }
    thicknessMemo.set(part.id, result)
    return result
  }

  /** 仕上がり寸法（入力値 − 逃げ） */
  function finishedOf(d: DimRef): Value {
    const key = dimKey(d.partId, d.axis)
    const memo = finishedMemo.get(key)
    if (memo) return memo
    if (onStack.has(key)) return { ok: false, error: loopError(key) }
    stack.push(key)
    onStack.add(key)

    let result: Value = inputOf(d)
    if (result.ok) {
      const part = partById.get(d.partId)!
      const clearance = part.clearance[d.axis] ?? 0
      let value = result.value
      // 逃げがなければ厚みの判定はいらない（余計な依存を作らない）
      if (clearance !== 0) {
        waitingThickness.add(key)
        const t = thicknessOf(part, key)
        waitingThickness.delete(key)
        if (!t.ok) {
          const origin = originOf(t.error)
          result =
            origin.partId === d.partId && origin.axis === d.axis
              ? setOwnError(d, cycleError(d))
              : { ok: false, error: propagate(d, t.error) }
        } else if (t.axis !== d.axis) {
          value -= clearance
        }
      }
      if (result.ok) {
        result =
          round1(value) <= 0
            ? setOwnError(d, {
                partId: d.partId,
                axis: d.axis,
                kind: 'nonPositive',
                message: `計算結果が 0 以下になります（${round1(value)}）`,
              })
            : { ok: true, value }
      }
    }

    stack.pop()
    onStack.delete(key)
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
    const t = thicknessOf(p, '')
    out.set(p.id, {
      input,
      inputAll: isComplete(input) ? input : null,
      finished: isComplete(finished) ? finished : null,
      thicknessInput: t.ok ? t.used : {},
      errors,
    })
  }
  return out
}

function isComplete(r: Partial<Record<Axis, number>>): r is Record<Axis, number> {
  return AXES.every((a) => r[a] !== undefined)
}

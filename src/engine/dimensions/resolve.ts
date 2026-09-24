// 参照の依存関係の整理：計算順（参照先が先）・存在しない部材・循環参照
import { refsOf } from '../formula/evaluate'
import { parse, type Expr } from '../formula/parse'
import { normalizePartName } from '../formula/tokenize'
import { AXES, type Axis, type DimensionError, type Part } from '../types'

/** 部材の1つの寸法（部材.W など） */
export interface DimRef {
  partId: string
  axis: Axis
}

/** 1つの寸法の式を読んだ結果 */
export interface DimNode extends DimRef {
  /** 構文木。読めない式なら null */
  ast: Expr | null
  /** 参照している寸法（存在する部材だけ） */
  deps: DimRef[]
}

export interface Resolution {
  /** 寸法ごとの式。キーは dimKey(partId, axis) */
  nodes: Map<string, DimNode>
  /** すべての寸法の計算順。参照先が先に並ぶ（循環している寸法も含む） */
  order: DimRef[]
  /** 式そのもののエラー（syntax・unknownRef・cycle）。部材の並び順 → W・H・D の順 */
  errors: DimensionError[]
}

export function dimKey(partId: string, axis: Axis): string {
  return `${partId}:${axis}`
}

/** 部材の式から依存関係を作り、計算順と、存在しない部材・循環参照を求める */
export function resolve(parts: readonly Part[]): Resolution {
  // そろえた部材名 → 部材（名前は重複しない前提。重複していれば先のものを使う）
  const byName = new Map<string, Part>()
  for (const p of parts) {
    const key = normalizePartName(p.name)
    if (!byName.has(key)) byName.set(key, p)
  }
  const nameOf = new Map(parts.map((p) => [p.id, p.name]))

  const nodes = new Map<string, DimNode>()
  const ownErrors = new Map<string, DimensionError[]>()
  const addError = (e: DimensionError) => {
    const key = dimKey(e.partId, e.axis)
    ownErrors.set(key, [...(ownErrors.get(key) ?? []), e])
  }

  for (const p of parts) {
    for (const axis of AXES) {
      const parsed = parse(p.expr[axis])
      if (!parsed.ok) {
        nodes.set(dimKey(p.id, axis), { partId: p.id, axis, ast: null, deps: [] })
        addError({ partId: p.id, axis, kind: 'syntax', message: parsed.error.message })
        continue
      }
      const deps: DimRef[] = []
      const unknown: string[] = []
      for (const ref of refsOf(parsed.ast)) {
        const target = byName.get(ref.part)
        if (target) deps.push({ partId: target.id, axis: ref.axis })
        else if (!unknown.includes(ref.part)) unknown.push(ref.part)
      }
      nodes.set(dimKey(p.id, axis), { partId: p.id, axis, ast: parsed.ast, deps })
      if (unknown.length > 0) {
        addError({
          partId: p.id,
          axis,
          kind: 'unknownRef',
          message: unknown.map((n) => `「${n}」という部材はありません`).join('。'),
          refs: unknown,
        })
      }
    }
  }

  // 強連結成分（Tarjan の方法）。成分は「参照先が先」の順に見つかるので、それをそのまま計算順にする
  const order: DimRef[] = []
  const keyIndex = new Map([...nodes.keys()].map((k, i) => [k, i]))
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  let counter = 0

  const label = (key: string) => {
    const n = nodes.get(key)!
    return `${nameOf.get(n.partId)}.${n.axis}`
  }

  /** 成分の中で start から start に戻る最短の道（BFS） */
  const cyclePath = (start: string, members: Set<string>): string[] => {
    const prev = new Map<string, string>()
    const queue = [start]
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]
      for (const d of nodes.get(cur)!.deps) {
        const k = dimKey(d.partId, d.axis)
        if (!members.has(k)) continue
        if (k === start) {
          const path = [cur]
          while (path[0] !== start) path.unshift(prev.get(path[0])!)
          return [...path, start]
        }
        if (!prev.has(k)) {
          prev.set(k, cur)
          queue.push(k)
        }
      }
    }
    return [start, start]
  }

  const visit = (key: string): void => {
    index.set(key, counter)
    low.set(key, counter)
    counter++
    stack.push(key)
    onStack.add(key)
    for (const d of nodes.get(key)!.deps) {
      const k = dimKey(d.partId, d.axis)
      if (!index.has(k)) {
        visit(k)
        low.set(key, Math.min(low.get(key)!, low.get(k)!))
      } else if (onStack.has(k)) {
        low.set(key, Math.min(low.get(key)!, index.get(k)!))
      }
    }
    if (low.get(key) !== index.get(key)) return

    const members: string[] = []
    let k: string
    do {
      k = stack.pop()!
      onStack.delete(k)
      members.push(k)
    } while (k !== key)
    // 成分の中は部材の並び順に
    members.sort((a, b) => keyIndex.get(a)! - keyIndex.get(b)!)

    const self = nodes.get(key)!
    const isCycle = members.length > 1 || self.deps.some((d) => dimKey(d.partId, d.axis) === key)
    const memberSet = new Set(members)
    for (const m of members) {
      const n = nodes.get(m)!
      order.push({ partId: n.partId, axis: n.axis })
      if (!isCycle) continue
      const path = cyclePath(m, memberSet)
      const names = [...new Set(path.map((p) => nameOf.get(nodes.get(p)!.partId)!))]
      addError({
        partId: n.partId,
        axis: n.axis,
        kind: 'cycle',
        message: `循環参照になっています（${path.map(label).join(' → ')}）`,
        refs: names,
      })
    }
  }

  for (const key of nodes.keys()) if (!index.has(key)) visit(key)

  const errors = [...nodes.keys()].flatMap((key) => ownErrors.get(key) ?? [])
  return { nodes, order, errors }
}

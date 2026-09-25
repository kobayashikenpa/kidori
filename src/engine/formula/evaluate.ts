// 構文木の計算と、参照の取り出し
import type { Axis } from '../types'
import { parse, type Expr, type FormulaError } from './parse'

/** ほかの部材の寸法への参照（部材名.W など） */
export interface Ref {
  part: string
  axis: Axis
}

export type EvalResult = { ok: true; value: number } | { ok: false; error: FormulaError }

/** 参照の値を返す関数。値がない（部材がない）ときは null */
export type RefLookup = (part: string, axis: Axis) => number | null

/** 構文木に出てくる参照の一覧（同じものは1回、出てきた順） */
export function refsOf(ast: Expr): Ref[] {
  const out: Ref[] = []
  const seen = new Set<string>()
  const walk = (e: Expr): void => {
    switch (e.type) {
      case 'number':
        return
      case 'ref': {
        const key = `${e.part}.${e.axis}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ part: e.part, axis: e.axis })
        }
        return
      }
      case 'neg':
        walk(e.arg)
        return
      case 'binary':
        walk(e.left)
        walk(e.right)
        return
    }
  }
  walk(ast)
  return out
}

/** 構文木を計算する。参照の値は lookup から受け取る。例外は投げない */
export function evaluate(ast: Expr, lookup: RefLookup): EvalResult {
  switch (ast.type) {
    case 'number':
      return { ok: true, value: ast.value }
    case 'ref': {
      const v = lookup(ast.part, ast.axis)
      if (v === null) {
        return {
          ok: false,
          error: { kind: 'unknownRef', message: `「${ast.part}」という部材はありません`, refs: [ast.part] },
        }
      }
      return { ok: true, value: v }
    }
    case 'neg': {
      const r = evaluate(ast.arg, lookup)
      return r.ok ? { ok: true, value: -r.value } : r
    }
    case 'binary': {
      const l = evaluate(ast.left, lookup)
      if (!l.ok) return l
      const r = evaluate(ast.right, lookup)
      if (!r.ok) return r
      switch (ast.op) {
        case '+':
          return { ok: true, value: l.value + r.value }
        case '-':
          return { ok: true, value: l.value - r.value }
        case '*':
          return { ok: true, value: l.value * r.value }
        case '/':
          if (r.value === 0) return { ok: false, error: { kind: 'divideByZero', message: '0 で割っています' } }
          return { ok: true, value: l.value / r.value }
      }
    }
  }
}

/** 式の文字列を構文解析して計算する */
export function evaluateExpr(expr: string, lookup: RefLookup): EvalResult {
  const p = parse(expr)
  return p.ok ? evaluate(p.ast, lookup) : p
}

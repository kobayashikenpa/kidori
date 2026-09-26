// 以前の版（第1版）のデータの移し替え：部材ごとの逃げ（clearance）を、設定の逃げ＋式で引く形に書き換える
import { defaultNige } from '../defaults'
import { computeDimensions } from '../dimensions'
import { tokenize } from '../formula/tokenize'
import { eq1, round1 } from '../round'
import { AXES, type Axis, type Job, type Nige, type Part, type PartChecks, type Settings } from '../types'

/** 以前の版の部材：メモ・チェックが無く、部材ごとの逃げ（mm）を持つ */
export type LegacyPart = Omit<Part, 'memo' | 'checks'> & {
  memo?: string
  checks?: PartChecks
  /** 以前の版の部材ごとの逃げ。板の面になる軸だけ引いていた */
  clearance?: Partial<Record<Axis, number>>
}

/** 以前の版の仕事：設定に逃げが無い。今の形の仕事もそのまま渡せる */
export type LegacyJob = Omit<Job, 'settings' | 'parts'> & {
  settings: Omit<Settings, 'nige'> & { nige?: Nige[] }
  parts: LegacyPart[]
}

/** 部材の逃げのうち、0 より大きい数の軸だけ */
function positiveClearance(p: LegacyPart): Partial<Record<Axis, number>> {
  const out: Partial<Record<Axis, number>> = {}
  for (const a of AXES) {
    const v = p.clearance?.[a]
    if (typeof v === 'number' && Number.isFinite(v) && round1(v) > 0) out[a] = v
  }
  return out
}

/** 式が数値1つか部材の参照1つなら括弧なしで引ける */
function isSingleTerm(expr: string): boolean {
  const t = tokenize(expr)
  return t.ok && t.tokens.length === 1 && (t.tokens[0].type === 'number' || t.tokens[0].type === 'ref')
}

/** 式から逃げを引く形に書き換える。空の式はそのまま */
function subtractNige(expr: string, nigeId: string): string {
  const e = expr.trim()
  if (!e) return expr
  return isSingleTerm(e) ? `${e} - {n:${nigeId}}` : `(${e}) - {n:${nigeId}}`
}

/**
 * 以前の版の仕事を今の形にする（元のデータは書き換えない）。
 * 1. 設定に逃げが無ければ初期の逃げ（0.5・1）を入れる
 * 2. 部材の逃げの値が設定に無ければ足す（id は makeId()、値の小さい順）
 * 3. 以前の計算と同じく厚みの寸法の軸には引かない。厚みの軸は、逃げをすべて外した仕事で決める
 *    （手で選んだ軸はそれ、自動なら板の厚みと同じ値の軸。決まらなければ3軸とも引く）
 * 4. 式を「元の式 - {n:id}」（数値1つ・参照1つ以外は括弧をつける）に書き換える
 * 5. メモ・チェックが無ければ足す
 * 部材ごとの逃げの無い仕事は、逃げ・メモ・チェックを補うだけなので、2回移し替えても変わらない
 */
export function migrateClearance(job: LegacyJob, makeId: () => string): Job {
  const nige: Nige[] = (job.settings.nige ?? defaultNige()).map((n) => ({ ...n }))

  const wanted = job.parts.flatMap((p) => Object.values(positiveClearance(p)))
  wanted.sort((a, b) => a - b)
  for (const v of wanted) {
    if (!nige.some((n) => eq1(n.value, v))) nige.push({ id: makeId(), value: round1(v) })
  }

  const parts: Part[] = job.parts.map((p) => {
    const { clearance: _clearance, ...rest } = p
    return {
      ...rest,
      expr: { ...p.expr },
      memo: typeof p.memo === 'string' ? p.memo : '',
      checks: { finished: p.checks?.finished === true, cut: p.checks?.cut === true },
    }
  })
  const base: Job = { ...job, settings: { ...job.settings, nige }, parts }

  if (!job.parts.some((p) => Object.keys(positiveClearance(p)).length > 0)) return base

  // 逃げをすべて外した仕事で厚みの寸法を決める
  const dims = computeDimensions(base)
  const thicknessOf = new Map(dims.parts.map((d) => [d.partId, d.thicknessAxis]))
  return {
    ...base,
    parts: parts.map((p, i) => {
      const clr = positiveClearance(job.parts[i])
      const thickness = thicknessOf.get(p.id) ?? null
      const expr = { ...p.expr }
      for (const a of AXES) {
        const v = clr[a]
        if (v === undefined || a === thickness) continue
        expr[a] = subtractNige(expr[a], nige.find((n) => eq1(n.value, v))!.id)
      }
      return { ...p, expr }
    }),
  }
}

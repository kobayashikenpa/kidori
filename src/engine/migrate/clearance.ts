// 以前の版（第1版）のデータの移し替え：部材ごとの逃げ（clearance）を、設定の逃げ＋式で引く形に書き換える
import { defaultNige, NIGE_DEFAULT_NAME } from '../defaults'
import { computeDimensions } from '../dimensions'
import { tokenize } from '../formula/tokenize'
import { computeV1Dimensions } from './v1Dimensions'
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

/** 逃げの値が同じか。移し替えでは丸めずに比べる（浮動小数の誤差だけ見のがす） */
const sameValue = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

/** 以前の部材ごとの逃げ v に当たる調整寸法（名前「逃げ」で、値が同じ） */
const isOldNige = (n: Nige, v: number): boolean => n.name === NIGE_DEFAULT_NAME && sameValue(n.value, v)

/** 部材の逃げのうち、0 より大きい数の軸だけ */
function positiveClearance(p: LegacyPart): Partial<Record<Axis, number>> {
  const out: Partial<Record<Axis, number>> = {}
  for (const a of AXES) {
    const v = p.clearance?.[a]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[a] = v
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

/** 移し替えで、以前の版と寸法（仕上がり寸法・厚みの軸・木取り寸法）が変わってしまった部材 */
export interface ChangedPart {
  partId: string
  name: string
}

/**
 * 以前の版の仕事を今の形にする（元のデータは書き換えない）。
 * 1. 設定に逃げが無ければ初期の逃げ（0.5・1）を入れる
 * 2. 部材の逃げの値が設定に無ければ足す（id は makeId()、値の小さい順）。値は丸めない（0.25 は 0.25 のまま）
 * 3. 以前の版の計算（computeV1Dimensions）で各部材の厚みの軸を求め、その軸には引かない
 *    （以前の版は、厚みの自動判定をその部材自身の逃げを引く前の値で、ほかの部材の値は逃げを引いた後の値で行っていた）。
 *    決まらなければ3軸とも引く
 * 4. 式を「元の式 - {n:id}」（数値1つ・参照1つ以外は括弧をつける）に書き換える
 * 5. 書き換えた後の自動判定で厚みの軸が以前と変わる部材は、以前の軸を手で選んだことにする（thicknessAxis に入れる）
 * 6. 以前の計算と、書き換えた後の計算で、仕上がり寸法・厚みの軸・木取り寸法を比べ、違う部材を changed に入れる
 *    （部材はそのまま残す）。ただし、以前は厚みが決まらなかった（木取り寸法が出なかった）部材が、
 *    仕上がり寸法は同じまま今は厚みが決まるときは、良くなっただけなので入れない
 * 7. メモ・チェックが無ければ足す
 * 部材ごとの逃げの無い仕事は、逃げ・メモ・チェックを補うだけなので、2回移し替えても変わらない
 */
export function migrateClearanceChecked(
  job: LegacyJob,
  makeId: () => string,
): { job: Job; changed: ChangedPart[] } {
  const nige: Nige[] = (job.settings.nige ?? defaultNige()).map((n) => ({ ...n }))

  const wanted = job.parts.flatMap((p) => Object.values(positiveClearance(p)))
  wanted.sort((a, b) => a - b)
  for (const v of wanted) {
    if (!nige.some((n) => isOldNige(n, v))) nige.push({ id: makeId(), name: NIGE_DEFAULT_NAME, value: v })
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

  const clearanceOf = new Map(job.parts.map((p) => [p.id, positiveClearance(p)]))
  if (![...clearanceOf.values()].some((c) => Object.keys(c).length > 0)) return { job: base, changed: [] }

  // 以前の版の計算で、厚みの軸と寸法を求める
  const v1 = computeV1Dimensions(base, clearanceOf)
  const rewritten: Job = {
    ...base,
    parts: parts.map((p) => {
      const clr = clearanceOf.get(p.id)!
      const thickness = v1.get(p.id)!.thicknessAxis
      const expr = { ...p.expr }
      for (const a of AXES) {
        const v = clr[a]
        if (v === undefined || a === thickness) continue
        expr[a] = subtractNige(expr[a], nige.find((n) => isOldNige(n, v))!.id)
      }
      return { ...p, expr }
    }),
  }

  // 自動判定の軸が以前と変わる部材は、以前の軸に固定する（仕上がり寸法は厚みの軸によらないので、1回で済む）
  const now = new Map(computeDimensions(rewritten).parts.map((d) => [d.partId, d]))
  const migrated: Job = {
    ...rewritten,
    parts: rewritten.parts.map((p) => {
      const before = v1.get(p.id)!.thicknessAxis
      if (p.thicknessAxis !== null || before === null || now.get(p.id)!.thicknessAxis === before) return p
      return { ...p, thicknessAxis: before }
    }),
  }

  const after = new Map(computeDimensions(migrated).parts.map((d) => [d.partId, d]))
  const changed: ChangedPart[] = migrated.parts
    .filter((p) => {
      const a = v1.get(p.id)!
      const b = after.get(p.id)!
      if (!sameDims(a.finished, b.finished)) return true
      // 以前は厚みが決まらず木取り寸法が出なかった部材が、今は決まるのは良くなっただけなので知らせない
      if (a.thicknessAxis === null) return false
      return a.thicknessAxis !== b.thicknessAxis || !sameDims(a.cutSize, b.cutSize)
    })
    .map((p) => ({ partId: p.id, name: p.name }))
  return { job: migrated, changed }
}

/** migrateClearanceChecked の仕事だけを返す */
export function migrateClearance(job: LegacyJob, makeId: () => string): Job {
  return migrateClearanceChecked(job, makeId).job
}

function sameDims(a: Record<Axis, number> | null, b: Record<Axis, number> | null): boolean {
  if (a === null || b === null) return a === b
  return AXES.every((axis) => sameValue(a[axis], b[axis]))
}

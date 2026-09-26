// 材料を減らせるときのお知らせ：切り代を優先して、今の値から 1mm ずつ小さくして 1mm まで・最後に 0.5mm で計算し直し、
// 必要枚数が減る材料を、減る一番大きい値で知らせる。切り代で減らない材料だけ端切りを同じように試す。
// 設定は変えない（知らせるだけ）
import { computeDimensions } from '../dimensions'
import { packJob } from '../packing'
import { round1 } from '../round'
import type { Job, PackingResult } from '../types'

export interface SavingHint {
  change: { kind: 'allowance' | 'trim'; value: number }
  /** 減る材料（板の登録順）。label は「ラワン 4mm」 */
  materials: { boardId: string; label: string; from: number; to: number }[]
  message: string
}

const KIND_LABEL = { allowance: '切り代', trim: '端切り' } as const

function mm(v: number): string {
  return String(round1(v))
}

function pack(job: Job): PackingResult {
  return packJob(job, computeDimensions(job))
}

/** 試す値の最後（0mm は試さない） */
export const SMALLEST_STEP = 0.5

/**
 * 試す値：今の値より小さい整数を大きい値から 1 まで（1mm 刻み）、最後に 0.5。0 は試さない。
 * 今の値が整数なら 今−1 から、小数なら切り捨てた値から。今の値が 0.5 以下なら何も試さない
 * （例：10 → 9…1, 0.5、7.5 → 7…1, 0.5、1 → 0.5、0.5 → なし）
 */
export function smallerSteps(current: number): number[] {
  const c = round1(current)
  const out: number[] = []
  for (let v = Math.ceil(c) - 1; v >= 1; v--) out.push(v)
  if (c > SMALLEST_STEP) out.push(SMALLEST_STEP)
  return out
}

function messageOf(kind: 'allowance' | 'trim', value: number, materials: SavingHint['materials']): string {
  const head = `${KIND_LABEL[kind]}を ${mm(value)}mm にすると、`
  if (materials.length === 1) {
    const m = materials[0]
    return `${head}${m.label} が ${m.from - m.to} 枚減ります（${m.from}枚 → ${m.to}枚）`
  }
  const list = materials.map((m) => `${m.label} が ${m.from - m.to} 枚（${m.from}枚 → ${m.to}枚）`).join('、')
  return `${head}${list}減ります`
}

/** 候補の設定で減る材料。必要枚数が減り、入らない部材が増えない材料だけ */
function reduced(base: PackingResult, trial: PackingResult): SavingHint['materials'] {
  const out: SavingHint['materials'] = []
  for (const m of base.materials) {
    const t = trial.materials.find((x) => x.boardId === m.boardId)
    if (!t || t.sheetCount >= m.sheetCount || t.unplaced.length > m.unplaced.length) continue
    out.push({ boardId: m.boardId, label: `${m.material} ${mm(m.thickness)}mm`, from: m.sheetCount, to: t.sheetCount })
  }
  return out
}

/**
 * 材料を減らせるときのお知らせ（仕様書 9）。仕事のデータは書き換えない。切り方・刃厚は今のまま。
 * 1. 切り代（仕事の切り代だけ。部材ごとの上書きはそのまま）を `smallerSteps` の値で大きい値から計算し直す。
 *    材料ごとに、必要枚数が減る一番大きい値でお知らせを出す（その値で減る材料をすべて入れる）。
 *    まだ出していない材料が減らない値ではお知らせを出さない
 * 2. 切り代で減らなかった材料だけ、端切りを同じように試す（お知らせにはその材料だけ入れる）
 * 切り代と端切りを同時に変える組み合わせは試さない。並びは 切り代（大きい値から）→ 端切り（大きい値から）。
 * 計算は最大で 1 +（切り代の試す数）+（端切りの試す数）回。2枚以上使う材料がすべて出たら、そこで打ち切る
 */
export function findSavingHints(job: Job): SavingHint[] {
  const allowances = smallerSteps(job.settings.allowance)
  const trims = smallerSteps(job.settings.trim)
  if (allowances.length === 0 && trims.length === 0) return []

  const base = pack(job)
  // 1枚以下の材料はそれ以上減らない
  const reducible = base.materials.filter((m) => m.sheetCount >= 2).map((m) => m.boardId)
  if (reducible.length === 0) return []

  const hints: SavingHint[] = []
  const shown = new Set<string>()
  const tryKind = (kind: 'allowance' | 'trim', values: number[], only: (boardId: string) => boolean) => {
    for (const value of values) {
      if (reducible.every((id) => shown.has(id))) return
      const trial = pack({ ...job, settings: { ...job.settings, [kind]: value } })
      const materials = reduced(base, trial).filter((m) => only(m.boardId))
      if (!materials.some((m) => !shown.has(m.boardId))) continue
      for (const m of materials) shown.add(m.boardId)
      hints.push({ change: { kind, value }, materials, message: messageOf(kind, value, materials) })
    }
  }
  tryKind('allowance', allowances, () => true)
  const byAllowance = new Set(shown)
  tryKind('trim', trims, (id) => !byAllowance.has(id))
  return hints
}

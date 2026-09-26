// 材料を減らせるときのお知らせ：切り代・端切りを1つずつ小さくして計算し直し、必要枚数が減る材料を知らせる。
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

export interface SavingHintOptions {
  /** 試す切り代（今の切り代より小さい値だけ試す）。初期値 0・5・10 */
  allowanceCandidates?: readonly number[]
  /** 試す端切り（今の端切りより小さい値だけ試す）。初期値 0 だけ（未決事項 19） */
  trimCandidates?: readonly number[]
}

export const DEFAULT_ALLOWANCE_CANDIDATES: readonly number[] = [0, 5, 10]
export const DEFAULT_TRIM_CANDIDATES: readonly number[] = [0]

const KIND_LABEL = { allowance: '切り代', trim: '端切り' } as const

function mm(v: number): string {
  return String(round1(v))
}

function pack(job: Job): PackingResult {
  return packJob(job, computeDimensions(job))
}

/** 今より小さい候補を、大きい値から（小さく変えるほうから）並べる。同じ値は1つ */
function smallerValues(candidates: readonly number[], current: number): number[] {
  const vs = [...new Set(candidates.map(round1))].filter((v) => v >= 0 && v < round1(current))
  return vs.sort((a, b) => b - a)
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

function sameMaterials(a: SavingHint['materials'], b: SavingHint['materials']): boolean {
  return a.length === b.length && a.every((m, i) => m.boardId === b[i].boardId && m.from === b[i].from && m.to === b[i].to)
}

/**
 * 材料を減らせるときのお知らせ。切り代（仕事の切り代だけ。部材ごとの上書きはそのまま）と端切りを
 * 1つずつ変えて計算し直す（組み合わせは試さない）。切り方・刃厚は今のまま。
 * 同じ種類で、より小さく変える候補が同じ材料・枚数になるなら、そのお知らせは出さない。
 * 並びは 切り代（大きい値から）→ 端切り（大きい値から）。仕事のデータは書き換えない
 */
export function findSavingHints(job: Job, options: SavingHintOptions = {}): SavingHint[] {
  const allowances = smallerValues(options.allowanceCandidates ?? DEFAULT_ALLOWANCE_CANDIDATES, job.settings.allowance)
  const trims = smallerValues(options.trimCandidates ?? DEFAULT_TRIM_CANDIDATES, job.settings.trim)
  if (allowances.length === 0 && trims.length === 0) return []

  const base = pack(job)
  const hints: SavingHint[] = []
  const tryKind = (kind: 'allowance' | 'trim', values: number[]) => {
    let shown: SavingHint['materials'] | null = null
    for (const value of values) {
      const trial = pack({ ...job, settings: { ...job.settings, [kind]: value } })
      const materials = reduced(base, trial)
      if (materials.length === 0 || (shown && sameMaterials(shown, materials))) continue
      shown = materials
      hints.push({ change: { kind, value }, materials, message: messageOf(kind, value, materials) })
    }
  }
  tryKind('allowance', allowances)
  tryKind('trim', trims)
  return hints
}

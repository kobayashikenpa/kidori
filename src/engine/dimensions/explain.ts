// 寸法表の内訳：式の各項（記号・数・参照とその値）と計算結果（仕様書 9「寸法表の表示の切り替え」、architecture.md 9.2）
import { boardTokenLabel, nigeName } from '../defaults'
import { parse } from '../formula/parse'
import { normalizePartName, tokenize } from '../formula/tokenize'
import { round1 } from '../round'
import type { Axis, DimensionError, Job } from '../types'
import { computeFinished, type FinishedDims } from './finished'

/** 内訳の1つの項 */
export type ExplainPiece =
  /** 記号（+ − × ÷ 括弧） */
  | { kind: 'op'; text: string }
  /** 式に書いた数 */
  | { kind: 'number'; value: number }
  /**
   * 参照。part：部材の寸法（全体.W）、thickness：材料の厚み（ラワン4）、nige：調整寸法（逃げ1）。
   * value は参照先の値（部材の寸法は仕上がり寸法）。計算できない・削除したものは null
   */
  | { kind: 'ref'; ref: 'part' | 'thickness' | 'nige'; label: string; value: number | null }

export interface DimensionExplanation {
  /** 式の左から順の項。読めない式なら空 */
  pieces: ExplainPiece[]
  /** 計算結果（仕上がり寸法）。計算できなければ null */
  result: number | null
  /** この寸法のエラー（式のエラー・参照先のエラー）。厚みの不一致は含まない */
  errors: DimensionError[]
}

const OP_TEXT: Readonly<Record<string, string>> = { '+': '+', '-': '−', '*': '×', '/': '÷', '(': '(', ')': ')' }

/**
 * 部材の1つの寸法の内訳。部材が無ければ null。
 * finished に computeFinished(job) の結果を渡すと計算し直さない（寸法表でたくさん呼ぶとき用）
 */
export function explainDimension(
  job: Pick<Job, 'parts' | 'boards' | 'settings'>,
  partId: string,
  axis: Axis,
  finished: ReadonlyMap<string, FinishedDims> = computeFinished(job),
): DimensionExplanation | null {
  const part = job.parts.find((p) => p.id === partId)
  const own = finished.get(partId)
  if (!part || !own) return null
  const result = own.finished[axis] ?? null
  const errors = own.errors.filter((e) => e.axis === axis)

  const t = tokenize(part.expr[axis])
  if (!t.ok || !parse(part.expr[axis]).ok) return { pieces: [], result, errors }

  const idByName = new Map<string, string>()
  for (const p of job.parts) {
    const key = normalizePartName(p.name)
    if (!idByName.has(key)) idByName.set(key, p.id)
  }
  const pieces: ExplainPiece[] = t.tokens.map((tok): ExplainPiece => {
    switch (tok.type) {
      case 'number':
        return { kind: 'number', value: tok.value }
      case 'ref': {
        const id = idByName.get(tok.part)
        const value = id === undefined ? null : (finished.get(id)?.finished[tok.axis] ?? null)
        return { kind: 'ref', ref: 'part', label: `${tok.part}.${tok.axis}`, value }
      }
      case 'thickness': {
        const board = job.boards.find((b) => b.id === tok.boardId)
        return board
          ? { kind: 'ref', ref: 'thickness', label: boardTokenLabel(board), value: board.thickness }
          : { kind: 'ref', ref: 'thickness', label: '（削除した材料）', value: null }
      }
      case 'nige': {
        const n = job.settings.nige.find((x) => x.id === tok.nigeId)
        return n
          ? { kind: 'ref', ref: 'nige', label: nigeName(n), value: n.value }
          : { kind: 'ref', ref: 'nige', label: '（削除した逃げ）', value: null }
      }
      default:
        return { kind: 'op', text: OP_TEXT[tok.type] }
    }
  })
  return { pieces, result, errors }
}

/** 内訳の数の表示。式に書いた数・調整寸法はそのまま（誤差だけ消す）、それ以外は小数第1位まで */
function num(v: number, exact: boolean): string {
  return String(exact ? Number(v.toFixed(6)) : round1(v))
}

/**
 * 内訳を1行の文字にする（例：全体.W 900 − 側板.W 18 × 2 = 864）。
 * 値の無い参照は名前だけ、結果が無ければ「= 」の代わりに「?」
 */
export function explanationText(e: DimensionExplanation): string {
  const words = e.pieces.map((p) => {
    if (p.kind === 'op') return p.text
    if (p.kind === 'number') return num(p.value, true)
    return p.value === null ? p.label : `${p.label} ${num(p.value, p.ref === 'nige')}`
  })
  words.push(e.result === null ? '?' : `= ${num(e.result, false)}`)
  return words.join(' ')
}

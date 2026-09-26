// 式の単位を画面の表示名にする（材料の厚みは ラワン4、調整寸法は 逃げ1・ほぞ15 など。mm は付けない）
import { nigeName } from '../defaults'
import { thicknessRefLabel } from '../flush'
import type { Job } from '../types'
import { normalizeFormulaText, parseBraceText, parseRefText } from './tokenize'
import { formulaUnits, type Unit } from './units'

const OP_LABELS: Readonly<Record<string, string>> = { '+': '+', '-': '−', '*': '×', '/': '÷' }

/**
 * 単位の表示名。* → ×、/ → ÷、- → −、{t:…} → ラワン4（フラッシュなら名前）、{n:…} → 逃げ1・ほぞ15（名前＋寸法）。
 * 材料・逃げが見つからなければ（削除した材料）／（削除した調整寸法）。読めないかたまりはそのまま
 */
export function unitLabel(unit: Unit, job: Pick<Job, 'boards' | 'flushes' | 'settings'>): string {
  const n = normalizeFormulaText(unit.text)
  switch (unit.kind) {
    case 'digit':
    case 'paren':
      return n
    case 'op':
      return OP_LABELS[n] ?? n
    case 'partRef': {
      const r = parseRefText(unit.text)
      return r ? `${r.part}.${r.axis}` : n
    }
    case 'thickness': {
      const id = parseBraceText(unit.text)?.id
      return (id === undefined ? null : thicknessRefLabel(job, id)) ?? '（削除した材料）'
    }
    case 'nige': {
      const id = parseBraceText(unit.text)?.id
      const nige = job.settings.nige.find((x) => x.id === id)
      return nige ? nigeName(nige) : '（削除した調整寸法）'
    }
    case 'bad':
      return unit.text
  }
}

/** 式のすべての単位の表示名 */
export function formulaLabels(expr: string, job: Pick<Job, 'boards' | 'flushes' | 'settings'>): string[] {
  return formulaUnits(expr).map((u) => unitLabel(u, job))
}

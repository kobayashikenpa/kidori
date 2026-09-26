// 式の単位を画面の表示名にする（材料の厚みは ラワン4、逃げは 逃げ1 など。mm は付けない）
import { boardTokenLabel, nigeName } from '../defaults'
import type { Job } from '../types'
import { normalizeFormulaText, parseBraceText, parseRefText } from './tokenize'
import { formulaUnits, type Unit } from './units'

const OP_LABELS: Readonly<Record<string, string>> = { '+': '+', '-': '−', '*': '×', '/': '÷' }

/**
 * 単位の表示名。* → ×、/ → ÷、- → −、{t:…} → ラワン4、{n:…} → 逃げ1。
 * 材料・逃げが見つからなければ（削除した材料）／（削除した逃げ）。読めないかたまりはそのまま
 */
export function unitLabel(unit: Unit, job: Pick<Job, 'boards' | 'settings'>): string {
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
      const board = job.boards.find((b) => b.id === id)
      return board ? boardTokenLabel(board) : '（削除した材料）'
    }
    case 'nige': {
      const id = parseBraceText(unit.text)?.id
      const nige = job.settings.nige.find((x) => x.id === id)
      return nige ? nigeName(nige.value) : '（削除した逃げ）'
    }
    case 'bad':
      return unit.text
  }
}

/** 式のすべての単位の表示名 */
export function formulaLabels(expr: string, job: Pick<Job, 'boards' | 'settings'>): string[] {
  return formulaUnits(expr).map((u) => unitLabel(u, job))
}

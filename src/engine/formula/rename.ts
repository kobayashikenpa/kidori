// 部材名を変えたときの、式の中の参照（旧名.W など）のつけ替え
import type { Part } from '../types'
import { isBraceText, normalizePartName, parseRefText, splitChunks, validatePartName } from './tokenize'

/** 式の中の「旧名.W/H/D」（全角で書いたものも）を「新名.W/H/D」に書き換える。ほかの部分（空白など）はそのまま残す */
export function renameRefsInExpr(expr: string, oldName: string, newName: string): string {
  const oldKey = normalizePartName(oldName)
  let out = ''
  let last = 0
  for (const item of splitChunks(expr)) {
    // 材料の厚み・逃げ {…} は部材の参照ではないので書き換えない
    if ('type' in item || isBraceText(item.text)) continue
    const ref = parseRefText(item.text)
    if (!ref || ref.part !== oldKey) continue
    out += expr.slice(last, item.start) + `${newName}.${ref.axis}`
    last = item.end
  }
  return out + expr.slice(last)
}

export type RenameResult = { ok: true; parts: Part[] } | { ok: false; message: string }

/**
 * 部材の名前を変え、すべての部材の式の参照をつけ替えた新しい一覧を返す（元の一覧は書き換えない）。
 * 使えない名前・ほかの部材と同じ名前ならエラー
 */
export function renamePart(parts: readonly Part[], partId: string, newName: string): RenameResult {
  const target = parts.find((p) => p.id === partId)
  if (!target) return { ok: false, message: '部材が見つかりません' }
  const oldName = target.name
  if (newName === oldName) return { ok: true, parts: [...parts] }
  const invalid = validatePartName(
    newName,
    parts.filter((p) => p.id !== partId).map((p) => p.name),
  )
  if (invalid) return { ok: false, message: invalid }
  return {
    ok: true,
    parts: parts.map((p) => ({
      ...p,
      name: p.id === partId ? newName : p.name,
      expr: {
        W: renameRefsInExpr(p.expr.W, oldName, newName),
        H: renameRefsInExpr(p.expr.H, oldName, newName),
        D: renameRefsInExpr(p.expr.D, oldName, newName),
      },
    })),
  }
}

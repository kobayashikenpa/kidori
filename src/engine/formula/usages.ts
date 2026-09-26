// 材料の厚み・逃げを式で使っている部材の一覧と、材料の id のつけ替え
import { AXES, type Axis, type Job } from '../types'
import { isBraceText, parseBraceText, splitChunks } from './tokenize'

/** 式に出てくる {t:…}／{n:…} の id（読めない式の中でも探す） */
function braceIds(expr: string, kind: 'thickness' | 'nige'): string[] {
  const out: string[] = []
  for (const item of splitChunks(expr)) {
    if ('type' in item || !isBraceText(item.text)) continue
    const b = parseBraceText(item.text)
    if (b && b.kind === kind) out.push(b.id)
  }
  return out
}

/** 式で id を使っている部材を「部材名（軸）」で返す（部材の並び順。軸が複数なら 棚板（W・D）） */
function partsUsing(job: Pick<Job, 'parts'>, kind: 'thickness' | 'nige', id: string): string[] {
  const out: string[] = []
  for (const p of job.parts) {
    const axes: Axis[] = AXES.filter((a) => braceIds(p.expr[a], kind).includes(id))
    if (axes.length > 0) out.push(`${p.name}（${axes.join('・')}）`)
  }
  return out
}

/** 式でその逃げを使っている部材（例：［棚板（W）］）。逃げを削除する前の確認に使う */
export function partsUsingNige(job: Pick<Job, 'parts'>, nigeId: string): string[] {
  return partsUsing(job, 'nige', nigeId)
}

/** 式でその材料の厚みを使っている部材（例：［天地板（W）］）。材料を削除する前の確認に使う */
export function partsUsingBoardThickness(job: Pick<Job, 'parts'>, boardId: string): string[] {
  return partsUsing(job, 'thickness', boardId)
}

/** 式の中の材料の厚み {t:古いid} を {t:新しいid} につけ替える（仕事のコピー用）。ほかの部分はそのまま */
export function remapBoardIds(expr: string, map: ReadonlyMap<string, string>): string {
  let out = ''
  let last = 0
  for (const item of splitChunks(expr)) {
    if ('type' in item || !isBraceText(item.text)) continue
    const b = parseBraceText(item.text)
    if (!b || b.kind !== 'thickness') continue
    const to = map.get(b.id)
    if (to === undefined) continue
    out += expr.slice(last, item.start) + `{t:${to}}`
    last = item.end
  }
  return out + expr.slice(last)
}

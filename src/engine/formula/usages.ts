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

/** 式で ids のどれかを使っている部材を「部材名（軸）」で返す（部材の並び順・部材ごとに1つ。軸が複数なら 棚板（W・D）） */
function partsUsing(job: Pick<Job, 'parts'>, kind: 'thickness' | 'nige', ids: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const p of job.parts) {
    const axes: Axis[] = AXES.filter((a) => braceIds(p.expr[a], kind).some((id) => ids.has(id)))
    if (axes.length > 0) out.push(`${p.name}（${axes.join('・')}）`)
  }
  return out
}

/** 式でその逃げを使っている部材（例：［棚板（W）］）。逃げを削除する前の確認に使う */
export function partsUsingNige(job: Pick<Job, 'parts'>, nigeId: string): string[] {
  return partsUsing(job, 'nige', new Set([nigeId]))
}

/** 式でいくつかの逃げのどれかを使っている部材（部材ごとに1つ）。逃げをまとめて削除する前の確認に使う */
export function partsUsingNiges(job: Pick<Job, 'parts'>, nigeIds: readonly string[]): string[] {
  return partsUsing(job, 'nige', new Set(nigeIds))
}

/** 式でその材料の厚みを使っている部材（例：［天地板（W）］）。材料を削除する前の確認に使う */
export function partsUsingBoardThickness(job: Pick<Job, 'parts'>, boardId: string): string[] {
  return partsUsing(job, 'thickness', new Set([boardId]))
}

/** 式でいくつかの材料のどれかの厚みを使っている部材（部材ごとに1つ）。材料をまとめて削除する前の確認に使う */
export function partsUsingBoardThicknesses(job: Pick<Job, 'parts'>, boardIds: readonly string[]): string[] {
  return partsUsing(job, 'thickness', new Set(boardIds))
}

/** 式の中の材料の厚み {t:古いid} を {t:新しいid} につけ替える（仕事のコピー用）。ほかの部分はそのまま */
export function remapBoardIds(expr: string, map: ReadonlyMap<string, string>): string {
  return remapRefIds(expr, { thickness: map })
}

/**
 * 式の中の材料の厚み {t:…} と逃げ {n:…} の id を、それぞれの表でつけ替える（第2.4版。architecture.md 16.3）。
 * 表に無い id・部材の参照・ほかの部分はそのまま。読めない式の中でもつけ替える
 */
export function remapRefIds(
  expr: string,
  maps: { thickness?: ReadonlyMap<string, string>; nige?: ReadonlyMap<string, string> },
): string {
  let out = ''
  let last = 0
  for (const item of splitChunks(expr)) {
    if ('type' in item || !isBraceText(item.text)) continue
    const b = parseBraceText(item.text)
    if (!b) continue
    const to = (b.kind === 'thickness' ? maps.thickness : maps.nige)?.get(b.id)
    if (to === undefined) continue
    out += expr.slice(last, item.start) + (b.kind === 'thickness' ? `{t:${to}}` : `{n:${to}}`)
    last = item.end
  }
  return out + expr.slice(last)
}

/**
 * 仕事で使っている材料・フラッシュ・逃げの id（第2.4版。共有のファイルに入れるもの。architecture.md 16.3・16.4）。
 * 部材の材料・フラッシュ、式の {t:…}（材料かフラッシュ）・{n:…}、使っているフラッシュの表面材の材料。
 * 仕事に無い id は入れない。読めない式の中も探す
 */
export function jobRefIds(job: Pick<Job, 'parts' | 'boards' | 'flushes' | 'settings'>): {
  boardIds: Set<string>
  flushIds: Set<string>
  nigeIds: Set<string>
} {
  const boardSet = new Set(job.boards.map((b) => b.id))
  const flushSet = new Set(job.flushes.map((f) => f.id))
  const nigeSet = new Set(job.settings.nige.map((n) => n.id))
  const boardIds = new Set<string>()
  const flushIds = new Set<string>()
  const nigeIds = new Set<string>()
  const addThickness = (id: string) => {
    if (boardSet.has(id)) boardIds.add(id)
    else if (flushSet.has(id)) flushIds.add(id)
  }
  for (const p of job.parts) {
    if (p.boardId !== null && boardSet.has(p.boardId)) boardIds.add(p.boardId)
    if (p.flushId !== undefined && flushSet.has(p.flushId)) flushIds.add(p.flushId)
    for (const a of AXES) {
      for (const id of braceIds(p.expr[a], 'thickness')) addThickness(id)
      for (const id of braceIds(p.expr[a], 'nige')) if (nigeSet.has(id)) nigeIds.add(id)
    }
  }
  for (const f of job.flushes) {
    if (!flushIds.has(f.id)) continue
    for (const face of f.faces) if (boardSet.has(face.boardId)) boardIds.add(face.boardId)
  }
  return { boardIds, flushIds, nigeIds }
}

/**
 * 部材1つの W・H・D の式の材料の厚み {t:from} を {t:to} に置き換える（第2.3版。仕様書 5.4「材料を変えたときの厚みの置き換え」、
 * architecture.md 15.7）。from・to は材料の id かフラッシュの id。置き換えた軸を W→H→D の順で返す。
 * 前か後の材料が無い（null）・同じ材料・式に {t:from} が無いときは、式をそのまま（同じ中身の写し）で axes は []。元の式は書き換えない
 */
export function swapThicknessRef(
  expr: Readonly<Record<Axis, string>>,
  from: string | null,
  to: string | null,
): { expr: Record<Axis, string>; axes: Axis[] } {
  const out: Record<Axis, string> = { W: expr.W, H: expr.H, D: expr.D }
  if (from === null || to === null || from === to) return { expr: out, axes: [] }
  const map = new Map([[from, to]])
  const axes: Axis[] = []
  for (const a of AXES) {
    const next = remapBoardIds(expr[a], map)
    if (next !== expr[a]) {
      out[a] = next
      axes.push(a)
    }
  }
  return { expr: out, axes }
}

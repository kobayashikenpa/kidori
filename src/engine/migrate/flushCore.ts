// 以前の版（第2.4版まで）のフラッシュの芯材（core）を、「芯材◯（木取りしない）」の材料と中身の1行に移す
// （第2.5版。仕様書 4「今のフラッシュは、材料グループに移す」、architecture.md 17.6）。
// 名前・厚み・式・寸法・計算結果は変わらない（id・stack はそのまま。片の id は木取りする中身だけで数えるので同じ）
import { defaultSheet } from '../defaults'
import { isAutoFlushName } from '../flush'
import { eq1 } from '../round'
import type { Board, Flush, GroupForm } from '../types'

/** 芯材の材料名 */
export const CORE_MATERIAL = '芯材'

/** 以前の版のフラッシュ：芯材の厚み（core）を持つ。今の形のもそのまま渡せる */
export type LegacyFlush = Flush & { core?: unknown }

/** ひな形の材料（store/template.ts の MaterialSpec と同じ形） */
export interface SpecMaterial {
  material: string
  thickness: number
  builtIn?: true
  noCut?: true
}

/** ひな形の材料グループ（store/template.ts の FlushSpec と同じ形）：中身は材料名＋厚みで持つ */
export interface SpecGroup {
  name: string
  faces: { material: string; thickness: number; count: number }[]
  stack?: true
  form?: GroupForm
  autoName?: true
}

/** 以前の版のひな形のフラッシュ：芯材の厚み（core）を持つ */
export type LegacySpecGroup = SpecGroup & { core?: unknown }

const key = (s: string) => s.trim().normalize('NFKC')

/** 移す対象の芯材の厚み（0 より大きい数）。無ければ null */
function coreOf(f: { core?: unknown }): number | null {
  return typeof f.core === 'number' && Number.isFinite(f.core) && f.core > 0 ? f.core : null
}

/** 芯材を移したあとの form・autoName（今あるものは残す） */
function groupMarks(f: { name: string; form?: GroupForm; autoName?: true }): { form: GroupForm; autoName?: true } {
  const out: { form: GroupForm; autoName?: true } = { form: f.form ?? 'flush' }
  if (f.autoName === true || isAutoFlushName(f.name)) out.autoName = true
  return out
}

/**
 * 仕事：芯材（core）のあるフラッシュを、芯材の材料＋中身の先頭の1行に移す。
 * 芯材の材料は材料名「芯材」・同じ厚み（小数第1位）のものを使い、木取りしないにする。無ければ 4×8 で材料の最後に足す
 * （同じ厚みの芯材は1つだけ）。core を持たないフラッシュはそのまま。引数の配列・オブジェクトは変えない
 */
export function migrateFlushCores(
  boards: readonly Board[],
  flushes: readonly LegacyFlush[],
  newBoardId: () => string,
): { boards: Board[]; flushes: Flush[] } {
  const out = [...boards]
  const coreBoard = (t: number): string => {
    const i = out.findIndex((b) => key(b.material) === CORE_MATERIAL && eq1(b.thickness, t))
    if (i >= 0) {
      if (out[i].noCut !== true) out[i] = { ...out[i], noCut: true }
      return out[i].id
    }
    const b: Board = { id: newBoardId(), material: CORE_MATERIAL, thickness: t, ...defaultSheet(), noCut: true }
    out.push(b)
    return b.id
  }
  const next = flushes.map((f): Flush => {
    const { core: _core, ...rest } = f
    const t = coreOf(f)
    if (t === null) return rest
    const id = coreBoard(t)
    const same = rest.faces.find((x) => x.boardId === id)
    const faces = same
      ? rest.faces.map((x) => (x === same ? { ...x, count: x.count + 1 } : x))
      : [{ boardId: id, count: 1 }, ...rest.faces]
    return { ...rest, faces, ...groupMarks(rest) }
  })
  return { boards: out, flushes: next }
}

/** ひな形：migrateFlushCores と同じことを材料名＋厚みで行う */
export function migrateFlushSpecCores(
  materials: readonly SpecMaterial[],
  flushes: readonly LegacySpecGroup[],
): { materials: SpecMaterial[]; flushes: SpecGroup[] } {
  const out = [...materials]
  const coreMaterial = (t: number): SpecMaterial => {
    const i = out.findIndex((m) => key(m.material) === CORE_MATERIAL && eq1(m.thickness, t))
    if (i >= 0) {
      if (out[i].noCut !== true) out[i] = { ...out[i], noCut: true }
      return out[i]
    }
    const m: SpecMaterial = { material: CORE_MATERIAL, thickness: t, noCut: true }
    out.push(m)
    return m
  }
  const next = flushes.map((f): SpecGroup => {
    const { core: _core, ...rest } = f
    const t = coreOf(f)
    if (t === null) return rest
    const m = coreMaterial(t)
    const isCore = (x: { material: string; thickness: number }) => key(x.material) === key(m.material) && eq1(x.thickness, m.thickness)
    const same = rest.faces.find(isCore)
    const faces = same
      ? rest.faces.map((x) => (x === same ? { ...x, count: x.count + 1 } : x))
      : [{ material: m.material, thickness: m.thickness, count: 1 }, ...rest.faces]
    return { ...rest, faces, ...groupMarks(rest) }
  })
  return { materials: out, flushes: next }
}

// 以前の版（第2.4版まで）のフラッシュの芯材（core）を、「芯材◯（木取りしない）」の材料と中身の1行に移す
// （第2.5版。仕様書 4「今のフラッシュは、材料グループに移す」、architecture.md 17.6）。
// 名前・厚み・式・寸法・計算結果は変わらない（id・stack はそのまま。片の id は木取りする中身だけで数えるので同じ）
import { defaultSheet } from '../defaults'
import { autoGroupName, flushThickness } from '../flush'
import { eq1 } from '../round'
import type { Board, Flush, GroupForm } from '../types'

/** 芯材の材料名 */
export const CORE_MATERIAL = '芯材'

/** 「芯材」の木取りする材料を部材などが使っているときに、別に足す木取りしない芯材の材料名 */
export const CORE_NO_CUT_MATERIAL = '芯材（木取りしない）'

/** 以前の版のフラッシュ：芯材の厚み（core）を持つ。今の形のもそのまま渡せる */
export type LegacyFlush = Flush & { core?: unknown }

const key = (s: string) => s.trim().normalize('NFKC')

/** 移す対象の芯材の厚み（0 より大きい数）。無ければ null */
function coreOf(f: { core?: unknown }): number | null {
  return typeof f.core === 'number' && Number.isFinite(f.core) && f.core > 0 ? f.core : null
}

/** name が、合計の厚み total の「フラッシュ」の自動の名前（フラッシュ25・フラッシュ25-2 など）か */
function isAutoNameFor(name: string, total: number): boolean {
  const base = autoGroupName('flush', total)
  const k = key(name)
  return k === base || (k.startsWith(`${base}-`) && /^[1-9]\d*$/.test(k.slice(base.length + 1)))
}

/** 芯材を移したあとの form・autoName（今あるものは残す）。total は移したあとの合計の厚み */
function groupMarks(f: { name: string; form?: GroupForm; autoName?: true }, total: number): { form: GroupForm; autoName?: true } {
  const out: { form: GroupForm; autoName?: true } = { form: f.form ?? 'flush' }
  if (f.autoName === true || isAutoNameFor(f.name, total)) out.autoName = true
  return out
}

/**
 * 芯材の材料を選ぶ。材料名は「芯材」→「芯材（木取りしない）」の順に見て、同じ厚み（小数第1位）の材料が
 * - 無ければ、その名前で木取りしない材料を足す
 * - 木取りしない材料なら、それを使う
 * - 木取りする材料で、どこにも使われていなければ、木取りしないにして使う
 * - 木取りする材料で、使われていれば（結果が変わるので）変えずに次の名前を見る
 * （仕様書 4「今のフラッシュは、材料グループに移す」：寸法・計算結果は変わらない）
 */
function pickCore<M extends { material: string; thickness: number; noCut?: true }>(
  out: M[],
  t: number,
  used: (m: M) => boolean,
  make: (material: string) => M,
): M {
  for (let n = 0; ; n++) {
    const name = n === 0 ? CORE_MATERIAL : n === 1 ? CORE_NO_CUT_MATERIAL : `${CORE_NO_CUT_MATERIAL}${n}`
    const i = out.findIndex((m) => key(m.material) === key(name) && eq1(m.thickness, t))
    if (i < 0) {
      const m = make(name)
      out.push(m)
      return m
    }
    if (out[i].noCut === true) return out[i]
    if (!used(out[i])) {
      out[i] = { ...out[i], noCut: true }
      return out[i]
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * 部材の材料（boardId）・固定した1枚（boardId・重ね切りのもう1つ stackWith.boardId）・重ね切りの組の設定（boardIds）で使っている材料の id。
 * 読み込む前の保存データ（形を確かめていない値）をそのまま渡せる。読めない値は飛ばす
 */
export function boardIdsInUse(job: { parts?: unknown; frozenSheets?: unknown; stackSheets?: unknown }): Set<string> {
  const ids = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v === 'string') ids.add(v)
  }
  for (const p of list(job.parts)) if (isObj(p)) add(p.boardId)
  for (const s of list(job.frozenSheets)) {
    if (!isObj(s)) continue
    add(s.boardId)
    if (isObj(s.stackWith)) add(s.stackWith.boardId)
  }
  for (const s of list(job.stackSheets)) if (isObj(s)) list(s.boardIds).forEach(add)
  return ids
}

/**
 * 仕事：芯材（core）のあるフラッシュを、芯材の材料＋中身の先頭の1行に移す。
 * 芯材の材料は pickCore の決まりで選ぶ（足すときは 4×8 で材料の最後。同じ厚みの芯材は1つだけ足す）。
 * inUse：部材・固定した1枚・組の設定で使っている材料の id（boardIdsInUse）。材料グループの中身・手持ちの行もここで使っているとみなす。
 * core を持たないフラッシュはそのまま。引数の配列・オブジェクトは変えない
 */
export function migrateFlushCores(
  boards: readonly Board[],
  flushes: readonly LegacyFlush[],
  newBoardId: () => string,
  inUse: ReadonlySet<string>,
): { boards: Board[]; flushes: Flush[] } {
  const out = [...boards]
  const used = (b: Board) =>
    inUse.has(b.id) || (b.stock?.length ?? 0) > 0 || flushes.some((f) => f.faces.some((x) => x.boardId === b.id))
  const next = flushes.map((f): Flush => {
    const { core: _core, ...rest } = f
    const t = coreOf(f)
    if (t === null) return rest
    const id = pickCore(out, t, used, (material) => ({ id: newBoardId(), material, thickness: t, ...defaultSheet(), noCut: true })).id
    const same = rest.faces.find((x) => x.boardId === id)
    const faces = same
      ? rest.faces.map((x) => (x === same ? { ...x, count: x.count + 1 } : x))
      : [{ boardId: id, count: 1 }, ...rest.faces]
    return { ...rest, faces, ...groupMarks(rest, flushThickness({ faces }, out)) }
  })
  return { boards: out, flushes: next }
}

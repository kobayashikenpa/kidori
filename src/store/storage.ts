// localStorage への保存と読み込み。読み書きはすべて try/catch で囲み、失敗しても例外を外に出さない
import { defaultNige, defaultSettings, NIGE_DEFAULT_NAME, nigeNameKey } from '../engine/defaults'
import { addMissingBuiltIns } from '../engine/boards'
import { validatePartName } from '../engine/formula/tokenize'
import { migrateClearanceChecked, type LegacyJob, type LegacyPart } from '../engine/migrate/clearance'
import { boardIdsInUse, migrateFlushCores, type LegacyFlush } from '../engine/migrate/flushCore'
import { canStack, stackPlan } from '../engine/packing/stack'
import { samePair, sameStockSize, usesStock } from '../engine/packing/stock'
import { eq1 } from '../engine/round'
import {
  AXES,
  BOARD_SIZES,
  DEFAULT_SETTINGS,
  type Axis,
  type Board,
  type BoardSizeKind,
  type CutMode,
  type CutStep,
  type FrozenSheet,
  type Placement,
  type Rect,
  type SheetLayout,
  type Flush,
  type GroupForm,
  type Job,
  type Nige,
  type PartGrain,
  type StackSheet,
  type StockSheet,
} from '../engine/types'
import { newId } from './jobs'

/** 保存データ第3版のキー（{ version: 3, jobs }。第2.5版の材料グループの形） */
export const JOBS_KEY = 'kidori.jobs.v3'
/**
 * 保存データ第2版のキー（{ version: 2, jobs }）。第3版が無いときだけ読み、移し替えて第3版に書く。
 * 前の版のアプリが読んでも新しいデータを壊さないよう、また控えとして、消さず・書き換えない
 */
export const JOBS_V2_KEY = 'kidori.jobs.v2'
/**
 * 以前の版（第1版）のキー。第3版・第2版が無いときだけ読み、移し替えて第3版に書く。
 * 移し替えがうまくいかなかったときの控えとして、消さず・書き換えない
 */
export const LEGACY_JOBS_KEY = 'kidori.jobs.v1'
export const CURRENT_JOB_KEY = 'kidori.currentJobId'
/**
 * 読めなかった保存データを退避しておくキーの頭。実際のキーは「頭.日時」（例：kidori.jobs.v2.broken.2026-09-25T10:00:00.000Z）。
 * 前の退避を上書きしないよう毎回別のキーにし、新しいものから MAX_BACKUPS 個だけ残す
 */
export const BROKEN_BACKUP_KEY = 'kidori.jobs.v2.broken'
/** 退避したキーの一覧（古い順） */
export const BROKEN_BACKUP_INDEX_KEY = 'kidori.jobs.v2.broken.index'
export const MAX_BACKUPS = 3
/** 退避キーがぶつかったときに、別のキーを試す回数の上限 */
const MAX_KEY_TRIES = 100

/** localStorage のうち使う部分。テストでは差し替える */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SavedData {
  jobs: Job[]
  currentJobId: string | null
}

export type LoadResult =
  /** 読めた。message は知らせ（以前の版から移したときに寸法が変わった部材があるとき） */
  | { status: 'ok'; data: SavedData; message?: string }
  /** まだ何も保存されていない */
  | { status: 'empty'; data: SavedData }
  /**
   * 一部が読めなかったので、読めるところだけ読んだ（おかしな部材・板は外し、おかしな値は初期値に直した）。
   * 元のデータは退避してある。canSave の意味は error と同じ
   */
  | { status: 'repaired'; data: SavedData; message: string; canSave: boolean }
  /**
   * 読めなかった。data は空。
   * canSave：壊れたデータを退避できたので、このあと保存してもよいか。
   * false のときに保存すると元のデータを上書きしてしまうので、保存しない
   */
  | { status: 'error'; data: SavedData; message: string; canSave: boolean }

export type SaveResult = { ok: true } | { ok: false; message: string }

const EMPTY: SavedData = { jobs: [], currentJobId: null }

/** ブラウザの localStorage。使えない環境（プライベートモードの一部など）では null */
export function browserStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------- 中身の検査と修復 ----------
// 手で書き換えたデータや途中までのデータでも画面が真っ白にならないよう、
// 読めない部材・板・仕事は外し、おかしな値は初期値に直す。直したら fixes に数える

/** 保存データの版（1：第1版、2：第1.1版〜第2.4版、3：第2.5版〜） */
export type DataVersion = 1 | 2 | 3
/** 今の保存データの版 */
export const DATA_VERSION = 3

interface Fixes {
  count: number
  /**
   * 読んでいるデータの版。第1版には逃げ・メモ・チェックが無いのが当たり前なので、無くても直した数に数えない
   */
  version: DataVersion
  /** 読み込むときに重ね切りを外したフラッシュの名前（サイズがそろわない組。15.9）。知らせに出す */
  unstacked: string[]
}

const isNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isAxis = (v: unknown): v is Axis => typeof v === 'string' && (AXES as readonly string[]).includes(v)
const CUT_MODES: readonly CutMode[] = ['vertical', 'horizontal', 'auto']
const SIZE_KINDS: readonly BoardSizeKind[] = ['saburoku', 'shihachi', 'custom']

/** 条件に合えばその値、合わなければ fallback（直した数を数える） */
function pick<T>(v: unknown, ok: (x: unknown) => x is T, fallback: T, fx: Fixes): T {
  if (ok(v)) return v
  fx.count++
  return fallback
}

/** 設定。逃げは第1版で無ければ undefined のまま（移し替えで初期の逃げを入れる） */
function sanitizeSettings(v: unknown, fx: Fixes): LegacyJob['settings'] {
  if (!isRecord(v)) {
    fx.count++
    const d = defaultSettings()
    return fx.version === 1 ? { ...d, nige: undefined } : d
  }
  return {
    kerf: pick(v.kerf, isNonNegative, DEFAULT_SETTINGS.kerf, fx),
    trim: pick(v.trim, isNonNegative, DEFAULT_SETTINGS.trim, fx),
    allowance: pick(v.allowance, isNonNegative, DEFAULT_SETTINGS.allowance, fx),
    cutMode: pick(v.cutMode, (x): x is CutMode => CUT_MODES.includes(x as CutMode), DEFAULT_SETTINGS.cutMode, fx),
    nige: sanitizeNige(v.nige, fx),
  }
}

/**
 * 逃げ（調整寸法）。配列でなければ初期値（第1版で無いときは undefined にして、移し替えで初期値を入れる）。
 * id が空・前の逃げと同じ、値が 0 以下・数でない、前の逃げと名前も寸法も同じものは外す。
 * 寸法は丸めずに比べる（以前の版から移した 0.25 と 0.3 は別の逃げとして残す）。
 * 名前が無い（第1.3版までのデータ）ものは「逃げ」にする（直した数には数えない）。名前が文字でない・空なら「逃げ」に直す
 */
function sanitizeNige(v: unknown, fx: Fixes): Nige[] | undefined {
  if (v === undefined && fx.version === 1) return undefined
  if (!Array.isArray(v)) {
    fx.count++
    return defaultNige()
  }
  const out: Nige[] = []
  for (const x of v) {
    if (!isRecord(x) || !isId(x.id) || !isPositive(x.value)) {
      fx.count++
      continue
    }
    let name = NIGE_DEFAULT_NAME
    if (typeof x.name === 'string' && x.name.trim()) name = x.name.trim()
    else if (x.name !== undefined) fx.count++
    const value = x.value
    const key = nigeNameKey(name)
    if (out.some((n) => n.id === x.id || (nigeNameKey(n.name) === key && Math.abs(n.value - value) < 1e-9))) {
      fx.count++
      continue
    }
    out.push({ id: x.id, name, value })
  }
  return out
}

/** 以前の版の部材ごとの逃げ。数の入っている軸だけ残す（移し替えで式に移す） */
function sanitizeClearance(v: unknown): LegacyPart['clearance'] {
  if (!isRecord(v)) return undefined
  const out: Partial<Record<Axis, number>> = {}
  for (const a of AXES) {
    const x = v[a]
    if (typeof x === 'number' && Number.isFinite(x)) out[a] = x
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 板。材料名・厚み・大きさが読めない板は外す（null） */
function sanitizeBoard(v: unknown, fx: Fixes): Board | null {
  if (!isRecord(v) || !isId(v.id)) return null
  const material = typeof v.material === 'string' ? v.material.trim() : ''
  if (!material || !isPositive(v.thickness) || !isPositive(v.width) || !isPositive(v.length)) return null
  return {
    id: v.id,
    material,
    thickness: v.thickness,
    sizeKind: pick(v.sizeKind, (x): x is BoardSizeKind => SIZE_KINDS.includes(x as BoardSizeKind), 'custom', fx),
    // 短辺 ≦ 長辺にそろえる（木取り計算は長辺を縦に置く前提）。逆なら入れ替えて直した数に数える
    width: v.width > v.length ? (fx.count++, v.length) : v.width,
    length: Math.max(v.width, v.length),
    grain: pick(v.grain, (x): x is Board['grain'] => x === 'long' || x === 'short', 'long', fx),
    // 最初から入っている材料の印（第1.2版）。無ければ付けない（並び順は engine の orderedBoards が以前のデータも判定する）
    ...(v.builtIn === true ? { builtIn: true as const } : {}),
    // 木取りしない（第2.5版）。true のときだけ持つ（ほかの値は外して直した数に数える）
    ...(v.noCut === true ? { noCut: true as const } : (v.noCut !== undefined && fx.count++, {})),
    ...sanitizeStock(v, fx),
  }
}

/**
 * 手持ちの材料（第2.2版。architecture.md 14.10）。stockOn は true のときだけ残す。stock は配列でなければ外す。
 * 行ごとに、id が文字で重ならない・種類が3つのどれか・枚数が1以上の整数・自由入力は短辺・長辺が 0 より大きい数、でなければ外す。
 * 3×6・4×8 の寸法と木目は決まった値に、自由入力の短辺＞長辺は入れ替える。stockOn で行が0になったら stockOn を外す（どれも直した数に数える）
 */
function sanitizeStock(v: Record<string, unknown>, fx: Fixes): Pick<Board, 'stockOn' | 'stock'> {
  const out: Pick<Board, 'stockOn' | 'stock'> = {}
  const rows: StockSheet[] = []
  if (v.stock !== undefined) {
    if (!Array.isArray(v.stock)) fx.count++
    for (const x of Array.isArray(v.stock) ? v.stock : []) {
      if (
        !isRecord(x) ||
        !isId(x.id) ||
        rows.some((r) => r.id === x.id) ||
        !SIZE_KINDS.includes(x.sizeKind as BoardSizeKind) ||
        !isCount(x.count) ||
        (x.sizeKind === 'custom' && (!isPositive(x.width) || !isPositive(x.length)))
      ) {
        fx.count++
        continue
      }
      const sizeKind = x.sizeKind as BoardSizeKind
      let width: number
      let length: number
      let grain: Board['grain']
      if (sizeKind === 'custom') {
        const w = x.width as number
        const l = x.length as number
        width = Math.min(w, l)
        length = Math.max(w, l)
        if (w > l) fx.count++
        grain = pick(x.grain, (g): g is Board['grain'] => g === 'long' || g === 'short', 'long', fx)
      } else {
        ;[width, length] = BOARD_SIZES[sizeKind]
        grain = 'long'
        if (x.width !== width || x.length !== length || x.grain !== 'long') fx.count++
      }
      rows.push({ id: x.id as string, sizeKind, width, length, grain, count: x.count as number })
    }
    if (Array.isArray(v.stock)) out.stock = rows
  }
  if (v.stockOn === true) {
    if (rows.length > 0) out.stockOn = true
    else fx.count++
  } else if (v.stockOn !== undefined) {
    fx.count++
  }
  if (out.stock && out.stock.length === 0) delete out.stock
  return out
}

/** 読めた大きさ（sanitizeBoard と同じ検査）。読めなければ null */
function sanitizeSize(v: Record<string, unknown>, fx: Fixes): Pick<Board, 'sizeKind' | 'width' | 'length' | 'grain'> | null {
  if (!isPositive(v.width) || !isPositive(v.length)) return null
  return {
    sizeKind: pick(v.sizeKind, (x): x is BoardSizeKind => SIZE_KINDS.includes(x as BoardSizeKind), 'custom', fx),
    width: v.width > v.length ? (fx.count++, v.length) : v.width,
    length: Math.max(v.width, v.length),
    grain: pick(v.grain, (x): x is Board['grain'] => x === 'long' || x === 'short', 'long', fx),
  }
}

/**
 * 重ね切りの組の設定（第2.3版。architecture.md 15.6）。配列でなければ []。
 * 行ごとに、boardIds が仕事にある違う2つの材料で、同じ組（並びを問わず）の行が前に無いこと、大きさが読めること、でなければ外す。
 * 大きさ・手持ちは材料と同じ検査・修復（sanitizeBoard・sanitizeStock）。どれも直した数に数える
 */
function sanitizeStackSheets(v: unknown, boards: readonly Board[], fx: Fixes): StackSheet[] {
  if (!Array.isArray(v)) {
    fx.count++
    return []
  }
  const ids = new Set(boards.map((b) => b.id))
  const out: StackSheet[] = []
  for (const x of v) {
    const pair = isRecord(x) && Array.isArray(x.boardIds) && x.boardIds.length === 2 ? (x.boardIds as unknown[]) : null
    const ok =
      pair !== null &&
      pair.every((id) => typeof id === 'string' && ids.has(id)) &&
      pair[0] !== pair[1] &&
      !out.some((s) => samePair(s.boardIds, pair as [string, string]))
    const size = ok ? sanitizeSize(x as Record<string, unknown>, fx) : null
    if (!ok || !size) {
      fx.count++
      continue
    }
    out.push({ boardIds: [pair[0] as string, pair[1] as string], ...size, ...sanitizeStock(x as Record<string, unknown>, fx) })
  }
  return out
}

/** 組の行の 3×6／4×8（寸法と木目は決まった値）。自由入力なら null */
function standardSize(sizeKind: BoardSizeKind): Pick<StackSheet, 'sizeKind' | 'width' | 'length' | 'grain'> | null {
  if (sizeKind === 'custom') return null
  const [width, length] = BOARD_SIZES[sizeKind]
  return { sizeKind, width, length, grain: 'long' }
}

/**
 * 組の設定（第2.3版。architecture.md 15.6・15.9・18.7）。組は 3×6／4×8 だけ（仕様書 4）。
 * - stackSheets が無い仕事（第2.2版まで）は1回移し替える：以前の決まりの組（stackPlan）ごとに、a・b がどちらも手持ちを使わず、
 *   大きさ・木目がそろい（第2.2版の決まり）、a か b が 3×6／4×8 なら、その大きさで組の行を作る
 * - stackSheets がある仕事は、組の行の手持ちを外す。自由入力の行は消す
 * 第2.6版：サイズがそろわないことを理由に重ね切りを外して知らせることはしない（材料グループの stack はそのまま残す。
 * 行の無い組の大きさは stackChoice の初期値）。壊れていたわけではないので直した数に数えない。固定した組の1枚は変えない（切った記録）
 */
function settleStacks(boards: Board[], flushes: Flush[], rows: StackSheet[] | null): StackSheet[] {
  const byId = new Map(boards.map((b) => [b.id, b]))
  const stackSheets: StackSheet[] = []
  if (rows === null) {
    for (const g of stackPlan({ boards, flushes }).groups) {
      const a = byId.get(g.boardIds[0])!
      const b = byId.get(g.boardIds[1])!
      const size = !usesStock(a) && !usesStock(b) && sameStockSize(a, b) ? (standardSize(a.sizeKind) ?? standardSize(b.sizeKind)) : null
      if (size) stackSheets.push({ boardIds: [a.id, b.id], ...size })
    }
  } else {
    for (const row of rows) {
      const size = standardSize(row.sizeKind)
      if (size) stackSheets.push({ boardIds: row.boardIds, ...size })
    }
  }
  return stackSheets
}

const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1
const GROUP_FORMS: readonly GroupForm[] = ['flush', 'beta', 'empty']

/**
 * フラッシュ（第1.5版）。無ければ []（第1.4版までのデータ。直した数に数えない）。
 * id が空・前と同じ、名前が空・前と同じ（全角半角をそろえて比べる）、以前の版の芯材（core）があって 0 以下のフラッシュは外す。
 * 無い材料・前と同じ材料・枚数が1以上の整数でない中身は外す。form は3つのどれか、autoName は true のときだけ残す（第2.5版）。
 * 芯材（core）はそのまま返す（sanitizeJob で migrateFlushCores に渡す）
 */
function sanitizeFlushes(v: unknown, boards: readonly Board[], fx: Fixes): LegacyFlush[] {
  const boardIds = new Set(boards.map((b) => b.id))
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    fx.count++
    return []
  }
  const out: LegacyFlush[] = []
  for (const x of v) {
    const name = isRecord(x) && typeof x.name === 'string' ? x.name.trim() : ''
    const key = name.normalize('NFKC')
    if (
      !isRecord(x) ||
      !isId(x.id) ||
      !name ||
      (x.core !== undefined && !isPositive(x.core)) ||
      out.some((f) => f.id === x.id || f.name.normalize('NFKC') === key)
    ) {
      fx.count++
      continue
    }
    const faces: Flush['faces'] = []
    if (!Array.isArray(x.faces)) fx.count++
    for (const f of Array.isArray(x.faces) ? x.faces : []) {
      if (!isRecord(f) || typeof f.boardId !== 'string' || !boardIds.has(f.boardId) || !isCount(f.count)) {
        fx.count++
        continue
      }
      const boardId = f.boardId
      if (faces.some((y) => y.boardId === boardId)) {
        fx.count++
        continue
      }
      faces.push({ boardId, count: f.count })
    }
    const flush: LegacyFlush = { id: x.id, name, faces }
    if (isPositive(x.core)) flush.core = x.core
    // 重ね切り（第2.0版〜第2.5版）：true なら残す（第2.6版からは計算では見ず、仕事の重ね切りの移し替えだけに使う。18.8）。
    // true 以外の値は外して数える
    if (x.stack === true) flush.stack = true
    else if (x.stack !== undefined) fx.count++
    if (GROUP_FORMS.includes(x.form as GroupForm)) flush.form = x.form as GroupForm
    else if (x.form !== undefined) fx.count++
    if (x.autoName === true) flush.autoName = true
    else if (x.autoName !== undefined) fx.count++
    out.push(flush)
  }
  return out
}

/** 表面材ごとの完了（第1.5版）。無ければ undefined。真偽値の項目だけ残す */
function sanitizeCutByBoard(v: unknown, fx: Fixes): Record<string, boolean> | undefined {
  if (v === undefined) return undefined
  if (!isRecord(v)) {
    fx.count++
    return undefined
  }
  const out: Record<string, boolean> = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'boolean') out[k] = x
    else fx.count++
  }
  return out
}

function sanitizeExpr(v: unknown, fx: Fixes): Record<Axis, string> {
  const src = isRecord(v) ? v : {}
  if (!isRecord(v)) fx.count++
  const one = (x: unknown): string => {
    if (typeof x === 'string') return x
    fx.count++
    return typeof x === 'number' && Number.isFinite(x) ? String(x) : ''
  }
  return { W: one(src.W), H: one(src.H), D: one(src.D) }
}

/** 部材。id・名前が読めない部材は外す（null）。ほかの値は初期値に直す */
function sanitizePart(
  v: unknown,
  boardIds: ReadonlySet<string>,
  flushIds: ReadonlySet<string>,
  fx: Fixes,
): LegacyPart | null {
  if (!isRecord(v) || !isId(v.id) || typeof v.name !== 'string') return null
  // フラッシュ（第1.5版）。無いフラッシュを指していれば外す
  const flushId =
    v.flushId === undefined ? undefined : typeof v.flushId === 'string' && flushIds.has(v.flushId) ? v.flushId : (fx.count++, undefined)
  let boardId =
    v.boardId === null || v.boardId === undefined
      ? null
      : typeof v.boardId === 'string' && boardIds.has(v.boardId)
        ? v.boardId
        : (fx.count++, null)
  if (flushId !== undefined && boardId !== null) {
    // フラッシュを選んだ部材は材料を持たない
    fx.count++
    boardId = null
  }
  const cutByBoard = flushId === undefined ? undefined : sanitizeCutByBoard(isRecord(v.checks) ? v.checks.cutByBoard : undefined, fx)
  const v2 = fx.version >= 2
  const memo = typeof v.memo === 'string' ? v.memo : (v2 && fx.count++, '')
  const checkOk = isRecord(v.checks) && typeof v.checks.finished === 'boolean' && typeof v.checks.cut === 'boolean'
  if (v2 && !checkOk) fx.count++
  const clearance = sanitizeClearance(v.clearance)
  return {
    id: v.id,
    name: v.name.trim(),
    boardId,
    ...(flushId !== undefined ? { flushId } : {}),
    expr: sanitizeExpr(v.expr, fx),
    thicknessAxis: v.thicknessAxis === null ? null : pick(v.thicknessAxis, isAxis, null, fx),
    quantity: pick(v.quantity, (x): x is number => Number.isInteger(x) && (x as number) >= 0, 1, fx),
    grain: pick(v.grain, (x): x is PartGrain => x === 'any' || isAxis(x), 'any', fx),
    memo,
    checks: {
      finished: isRecord(v.checks) && v.checks.finished === true,
      cut: isRecord(v.checks) && v.checks.cut === true,
      ...(cutByBoard ? { cutByBoard } : {}),
    },
    allowance: v.allowance === null || v.allowance === undefined ? null : pick(v.allowance, isNonNegative, null, fx),
    ...(clearance ? { clearance } : {}),
  }
}

// ---------- 固定した1枚（第1.8版。architecture.md 11.8） ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isDateText = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x))

/** 長方形。形が壊れていれば null */
function readRect(v: unknown): Rect | null {
  if (!isRecord(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.w) || !isNum(v.h)) return null
  return { x: v.x, y: v.y, w: v.w, h: v.h }
}

/** 長方形の配列。1つでも壊れていれば null */
function readRects(v: unknown): Rect[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map(readRect)
  return out.every((r): r is Rect => r !== null) ? out : null
}

function readPlacement(v: unknown): Placement | null {
  const r = readRect(v)
  if (!r || !isRecord(v) || !isId(v.pieceId) || !isId(v.partId) || !isStr(v.name) || !isStr(v.sizeLabel)) return null
  return { ...r, pieceId: v.pieceId, partId: v.partId, name: v.name, rotated: v.rotated === true, sizeLabel: v.sizeLabel }
}

const CUT_KINDS: readonly CutStep['kind'][] = ['trim', 'strip', 'crosscut', 'rip']

function readCut(v: unknown): CutStep | null {
  if (!isRecord(v)) return null
  const within = readRect(v.within)
  const dirOk = v.direction === 'vertical' || v.direction === 'horizontal'
  const kindOk = typeof v.kind === 'string' && (CUT_KINDS as readonly string[]).includes(v.kind)
  if (!within || !dirOk || !kindOk || !isNum(v.no) || !isNum(v.at) || !isStr(v.label)) return null
  return {
    no: v.no,
    direction: v.direction as CutStep['direction'],
    at: v.at,
    within,
    kind: v.kind as CutStep['kind'],
    label: v.label,
  }
}

/** 固定した1枚の写し。数（幅・長さ・長方形）が数でない・片が無い・片の id が重なるなど、形が壊れていれば null */
function readLayout(v: unknown, fx: Fixes): SheetLayout | null {
  if (!isRecord(v)) return null
  if (!isNum(v.boardWidth) || !isNum(v.boardLength) || v.boardWidth <= 0 || v.boardLength <= 0) return null
  if (v.orientation !== 'portrait' && v.orientation !== 'landscape') return null
  const usable = readRect(v.usable)
  const trims = readRects(v.trims)
  const scraps = readRects(v.scraps)
  if (!usable || !trims || !scraps || !Array.isArray(v.placements) || !Array.isArray(v.cuts)) return null
  const placements = v.placements.map(readPlacement)
  if (placements.length === 0 || !placements.every((p): p is Placement => p !== null)) return null
  if (new Set(placements.map((p) => p.pieceId)).size !== placements.length) return null
  const cuts = v.cuts.map(readCut)
  if (!cuts.every((c): c is CutStep => c !== null)) return null
  if (!isNum(v.usedArea) || !isNum(v.yieldRate)) return null
  const layout: SheetLayout = {
    index: isNum(v.index) ? v.index : 1,
    boardWidth: v.boardWidth,
    boardLength: v.boardLength,
    orientation: v.orientation,
    trims,
    usable,
    placements,
    cuts,
    scraps,
    usedArea: v.usedArea,
    yieldRate: v.yieldRate,
  }
  // 手持ちの1枚（第2.2版）：使った手持ちの行と木目。読めなければ付けない（1枚は描ける）
  const sh = v.sheet
  if (
    isRecord(sh) &&
    isId(sh.stockId) &&
    SIZE_KINDS.includes(sh.sizeKind as BoardSizeKind) &&
    (sh.grain === 'long' || sh.grain === 'short')
  ) {
    layout.sheet = { stockId: sh.stockId, sizeKind: sh.sizeKind as BoardSizeKind, grain: sh.grain }
    // 重ねた板の端材から取った1枚（第2.6版）：source が 1 以上の整数でなければ offcut だけ外す（直した数に数える）
    if (sh.offcut !== undefined) {
      if (isRecord(sh.offcut) && isCount(sh.offcut.source)) layout.sheet.offcut = { source: sh.offcut.source }
      else fx.count++
    }
  }
  return layout
}

/**
 * 固定した1枚の一覧。無ければ []（直した数に数えない）。読めない1枚・id の重なる1枚・チェックが空になった1枚は外す。
 * 写しに無い・重なるチェックは外す。completedAt は全部チェックなら残し（無ければ frozenAt）、そうでなければ消す。
 * 材料が削除されていても外さない（写しで表示する）
 */
function sanitizeFrozenSheets(v: unknown, fallbackDate: string, fx: Fixes): FrozenSheet[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    fx.count++
    return []
  }
  const out: FrozenSheet[] = []
  for (const raw of v) {
    const layout = isRecord(raw) ? readLayout(raw.layout, fx) : null
    const modeOk = isRecord(raw) && (raw.mode === 'vertical' || raw.mode === 'horizontal')
    if (!isRecord(raw) || !layout || !modeOk || !isId(raw.id) || !isId(raw.boardId) || out.some((f) => f.id === raw.id)) {
      fx.count++
      continue
    }
    const ids = new Set(layout.placements.map((p) => p.pieceId))
    const rawChecked: unknown[] = Array.isArray(raw.checked) ? raw.checked : []
    const checked = [...new Set(rawChecked.filter((x): x is string => typeof x === 'string' && ids.has(x)))]
    if (!Array.isArray(raw.checked) || checked.length !== rawChecked.length || checked.length === 0) fx.count++
    if (checked.length === 0) continue
    // 重ね切りの1枚（第2.0版）：もう1つの材料の id が読めない・自分と同じなら、どの材料から引くか分からないので1枚ごと外す
    const sw = raw.stackWith
    if (sw !== undefined && (!isRecord(sw) || !isId(sw.boardId) || sw.boardId === raw.boardId)) {
      fx.count++
      continue
    }
    const frozenAt = pick(raw.frozenAt, isDateText, fallbackDate, fx)
    const sheet: FrozenSheet = {
      id: raw.id,
      boardId: raw.boardId,
      material: pick(raw.material, isStr, '', fx),
      thickness: pick(raw.thickness, isPositive, 1, fx),
      grain: pick(raw.grain, (x): x is 'long' | 'short' => x === 'long' || x === 'short', 'long', fx),
      mode: raw.mode as FrozenSheet['mode'],
      kerf: pick(raw.kerf, isNonNegative, DEFAULT_SETTINGS.kerf, fx),
      trim: pick(raw.trim, isNonNegative, DEFAULT_SETTINGS.trim, fx),
      layout,
      checked,
      frozenAt,
    }
    if (isRecord(sw) && isId(sw.boardId)) {
      sheet.stackWith = {
        boardId: sw.boardId,
        material: pick(sw.material, isStr, '', fx),
        thickness: pick(sw.thickness, isPositive, 1, fx),
      }
    }
    const complete = checked.length === ids.size
    if (complete) sheet.completedAt = pick(raw.completedAt, isDateText, frozenAt, fx)
    else if (raw.completedAt !== undefined) fx.count++
    out.push(sheet)
  }
  return out
}

/**
 * 消した最初の材料のキー（第2.5.1版）。無ければ undefined。配列でなければ直した数に数えて無しに、
 * 文字でないもの・空・重なりは外して直した数に数える
 */
function sanitizeRemovedBuiltIns(v: unknown, fx: Fixes): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) {
    fx.count++
    return undefined
  }
  const out: string[] = []
  for (const k of v) {
    if (typeof k !== 'string' || k === '' || out.includes(k)) fx.count++
    else out.push(k)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 重ね切り（第2.6版）が無い仕事（第2.5.1版まで）の重ね切りを1回決める（architecture.md 18.8。未決事項 59）。
 * 部材（枚数1以上）が使っている材料グループのうち、以前の決まりで重ねられた（canStack）のに「重ねて切る」を外していたものが
 * 1つでもあれば 'off'、ほかは 'on'。直した数に数えない・知らせない
 */
function legacyStacking(boards: readonly Board[], flushes: readonly Flush[], parts: readonly LegacyPart[]): 'on' | 'off' {
  const used = new Set(parts.filter((p) => p.quantity >= 1 && p.flushId !== undefined).map((p) => p.flushId))
  return flushes.some((f) => used.has(f.id) && f.stack !== true && canStack(f, boards)) ? 'off' : 'on'
}

/** 仕事。id が読めない仕事は外す（null）。以前の版の形（部材ごとの逃げ）が残っていてもよい */
function sanitizeJob(v: unknown, fx: Fixes): LegacyJob | null {
  if (!isRecord(v) || !isId(v.id)) return null
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : (fx.count++, '名前のない仕事')

  const boards: Board[] = []
  if (!Array.isArray(v.boards)) fx.count++
  for (const raw of Array.isArray(v.boards) ? v.boards : []) {
    const b = sanitizeBoard(raw, fx)
    // 読めない板・id や材料名＋厚みが前の板と同じ板は外す
    const dup = b && boards.some((x) => x.id === b.id || (x.material === b.material && eq1(x.thickness, b.thickness)))
    if (!b || dup) fx.count++
    else boards.push(b)
  }

  // 以前の版のフラッシュの芯材（core）を「芯材◯（木取りしない）」の材料と中身に移す（第2.5版。17.6）。
  // 壊れていたわけではないので直した数に数えない。足した芯材の材料も boardIds に入れてから部材を読む。
  // 部材などが使っている木取りする「芯材」は木取りしないにしない（結果が変わらないように。別の芯材を足す）
  const moved = migrateFlushCores(boards, sanitizeFlushes(v.flushes, boards, fx), () => newId('board'), boardIdsInUse(v))
  boards.splice(0, boards.length, ...moved.boards)
  const boardIds = new Set(boards.map((b) => b.id))
  // 重ね切りの組の設定（第2.3版）。無い仕事（第2.2版まで）だけ1回移し替える。組は 3×6／4×8 だけ（15.9）
  const stackSheets = settleStacks(
    boards,
    moved.flushes,
    v.stackSheets === undefined ? null : sanitizeStackSheets(v.stackSheets, boards, fx),
  )
  const flushes = moved.flushes
  const flushIds = new Set(flushes.map((f) => f.id))
  const parts: LegacyPart[] = []
  if (!Array.isArray(v.parts)) fx.count++
  for (const raw of Array.isArray(v.parts) ? v.parts : []) {
    const p = sanitizePart(raw, boardIds, flushIds, fx)
    // 読めない部材・使えない名前・名前や id が前の部材と同じ部材は外す
    const bad =
      !p ||
      parts.some((x) => x.id === p.id) ||
      validatePartName(
        p.name,
        parts.map((x) => x.name),
      ) !== null
    if (bad) fx.count++
    else parts.push(p)
  }

  const isDate = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x))
  const fallbackDate = isDate(v.updatedAt) ? v.updatedAt : isDate(v.createdAt) ? v.createdAt : new Date(0).toISOString()
  const removedBuiltIns = sanitizeRemovedBuiltIns(v.removedBuiltIns, fx)
  return {
    id: v.id,
    name,
    settings: sanitizeSettings(v.settings, fx),
    boards,
    flushes,
    parts,
    frozenSheets: sanitizeFrozenSheets(v.frozenSheets, fallbackDate, fx),
    stackSheets,
    stacking: v.stacking === 'on' || v.stacking === 'off' ? v.stacking : ((v.stacking !== undefined && fx.count++), legacyStacking(boards, flushes, parts)),
    ...(removedBuiltIns ? { removedBuiltIns } : {}),
    createdAt: pick(v.createdAt, isDate, fallbackDate, fx),
    updatedAt: pick(v.updatedAt, isDate, fallbackDate, fx),
  }
}

/**
 * 仕事の一覧を検査し、読めるものだけを返す。fixes は直した・外した数。
 * 以前の版の部材ごとの逃げは migrateClearance で設定の逃げ＋式に移す（第2版に古い形が混ざっていても同じ。寸法は変わらない）
 */
export function sanitizeJobs(
  list: readonly unknown[],
  version: DataVersion = DATA_VERSION,
): { jobs: Job[]; fixes: number; changed: string[]; unstacked: string[] } {
  const fx: Fixes = { count: 0, version, unstacked: [] }
  const jobs: Job[] = []
  const changed: string[] = []
  for (const raw of list) {
    const legacy = sanitizeJob(raw, fx)
    if (!legacy || jobs.some((j) => j.id === legacy.id)) {
      fx.count++
      continue
    }
    const m = migrateClearanceChecked(legacy, () => newId('nige'))
    // 最初から入っている材料で、この仕事に無いもの（消したものは除く）を足す（第2.5.1版）。直した数には数えない
    jobs.push(addMissingBuiltIns(m.job, newId))
    if (m.changed.length > 0) changed.push(`${m.job.name}の ${m.changed.map((c) => c.name).join('・')}`)
  }
  return { jobs, fixes: fx.count, changed, unstacked: [...new Set(fx.unstacked)] }
}

/** 移し替えで寸法が変わった部材・重ね切りを外したフラッシュの知らせ（「。」でつなぐ）。無ければ null */
export function changedMessage(changed: readonly string[], unstacked: readonly string[] = []): string | null {
  const out: string[] = []
  if (changed.length > 0) out.push(`以前の版から移したときに寸法が変わった部材：${changed.join('、')}（寸法表で確かめてください）`)
  if (unstacked.length > 0) out.push(`サイズがそろっていないので、重ね切りを外しました：${unstacked.join('、')}`)
  return out.length > 0 ? out.join('。') : null
}

/** 保存データの外側（版と仕事の配列）が読めれば、その配列。読めなければ null */
function parseJobList(raw: string, version: DataVersion): unknown[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.version !== version || !Array.isArray(data.jobs)) return null
  return data.jobs
}

// ---------- 読めなかったデータの退避 ----------

function readBackupIndex(storage: KeyValueStorage): string[] {
  try {
    const raw = storage.getItem(BROKEN_BACKUP_INDEX_KEY)
    const v: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * 読めなかった保存データを、日時つきの新しいキーに退避する。前の退避は上書きしない。
 * 同じ中身の退避がすでにあれば作らない。退避が MAX_BACKUPS 個を超えたら古いものから消す。退避できたら（またはすでにあれば）true
 */
export function backupBroken(storage: KeyValueStorage, raw: string, now: Date = new Date()): boolean {
  try {
    const index = readBackupIndex(storage)
    // 同じ中身をもう退避してあれば、新しく作らない（開き直すたびに古い退避が押し出されないように）
    if (index.some((k) => storage.getItem(k) === raw)) return true
    const base = `${BROKEN_BACKUP_KEY}.${now.toISOString()}`
    let key: string | null = null
    for (let i = 1; i <= MAX_KEY_TRIES; i++) {
      const k = i === 1 ? base : `${base}-${i}`
      if (!index.includes(k) && storage.getItem(k) === null) {
        key = k
        break
      }
    }
    // 空いているキーが見つからなければ、退避できなかったとして扱う
    if (key === null) return false
    storage.setItem(key, raw)
    const next = [...index, key]
    const old = next.slice(0, Math.max(0, next.length - MAX_BACKUPS))
    const keep = next.slice(old.length)
    storage.setItem(BROKEN_BACKUP_INDEX_KEY, JSON.stringify(keep))
    for (const k of old) {
      try {
        storage.removeItem(k)
      } catch {
        // 消せなくても退避はできている
      }
    }
    return true
  } catch {
    return false
  }
}

/** 仕事の一覧と開いている仕事の id を読む。例外は投げない */
export function loadSaved(storage: KeyValueStorage | null, now: Date = new Date()): LoadResult {
  if (!storage) {
    return { status: 'error', data: { ...EMPTY }, message: 'この端末では保存が使えません', canSave: false }
  }
  let raw: string | null
  let current: string | null
  let version: DataVersion = DATA_VERSION
  try {
    raw = storage.getItem(JOBS_KEY)
    current = storage.getItem(CURRENT_JOB_KEY)
    // 第3版が無ければ第2版、それも無ければ第1版を読んで移し替える（以前の版のキーはそのまま残す）
    if (raw === null) {
      raw = storage.getItem(JOBS_V2_KEY)
      version = 2
    }
    if (raw === null) {
      raw = storage.getItem(LEGACY_JOBS_KEY)
      version = 1
    }
  } catch {
    return { status: 'error', data: { ...EMPTY }, message: '保存データを読めませんでした', canSave: false }
  }
  if (raw === null) return { status: 'empty', data: { jobs: [], currentJobId: null } }
  const list = parseJobList(raw, version)
  if (!list) {
    const canSave = backupBroken(storage, raw, now)
    return {
      status: 'error',
      data: { ...EMPTY },
      message: canSave
        ? '保存データを読めませんでした（読めなかったデータは別の場所に残してあります）'
        : '保存データを読めませんでした（データを守るため、このままでは保存しません）',
      canSave,
    }
  }
  let sanitized: ReturnType<typeof sanitizeJobs>
  try {
    sanitized = sanitizeJobs(list, version)
  } catch {
    // 移し替えの途中で思わぬ形に出会っても、画面は出す。元のデータは残し、保存もしない
    return { status: 'error', data: { ...EMPTY }, message: '保存データを読めませんでした', canSave: false }
  }
  const { jobs, fixes } = sanitized
  const currentJobId = current !== null && jobs.some((j) => j.id === current) ? current : null
  const notice = changedMessage(sanitized.changed, sanitized.unstacked)
  if (fixes === 0) return { status: 'ok', data: { jobs, currentJobId }, ...(notice ? { message: notice } : {}) }
  const canSave = backupBroken(storage, raw, now)
  const repaired = canSave
    ? '保存データの一部が読めなかったので、読めるところだけ読み込みました（元のデータは別の場所に残してあります）'
    : '保存データの一部が読めなかったので、読めるところだけ読み込みました（データを守るため、このままでは保存しません）'
  return {
    status: 'repaired',
    data: { jobs, currentJobId },
    message: notice ? `${repaired}。${notice}` : repaired,
    canSave,
  }
}

/** 仕事の一覧と開いている仕事の id を第3版のキーに書く。以前の版のキー（v2・v1）には触らない。例外は投げない */
export function saveSaved(storage: KeyValueStorage | null, data: SavedData): SaveResult {
  if (!storage) return { ok: false, message: 'この端末では保存が使えません' }
  try {
    storage.setItem(JOBS_KEY, JSON.stringify({ version: DATA_VERSION, jobs: data.jobs }))
    storage.setItem(CURRENT_JOB_KEY, data.currentJobId ?? '')
    return { ok: true }
  } catch {
    return { ok: false, message: '保存できませんでした（端末の空き容量などを確かめてください）' }
  }
}

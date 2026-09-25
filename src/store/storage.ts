// localStorage への保存と読み込み。読み書きはすべて try/catch で囲み、失敗しても例外を外に出さない
import { validatePartName } from '../engine/formula/tokenize'
import { eq1 } from '../engine/round'
import {
  AXES,
  DEFAULT_SETTINGS,
  type Axis,
  type Board,
  type BoardSizeKind,
  type CutMode,
  type Job,
  type Part,
  type PartGrain,
  type Settings,
} from '../engine/types'

export const JOBS_KEY = 'kidori.jobs.v1'
export const CURRENT_JOB_KEY = 'kidori.currentJobId'
/**
 * 読めなかった保存データを退避しておくキーの頭。実際のキーは「頭.日時」（例：kidori.jobs.v1.broken.2026-09-25T10:00:00.000Z）。
 * 前の退避を上書きしないよう毎回別のキーにし、新しいものから MAX_BACKUPS 個だけ残す
 */
export const BROKEN_BACKUP_KEY = 'kidori.jobs.v1.broken'
/** 退避したキーの一覧（古い順） */
export const BROKEN_BACKUP_INDEX_KEY = 'kidori.jobs.v1.broken.index'
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
  /** 読めた */
  | { status: 'ok'; data: SavedData }
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

interface Fixes {
  count: number
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

function sanitizeSettings(v: unknown, fx: Fixes): Settings {
  if (!isRecord(v)) {
    fx.count++
    return { ...DEFAULT_SETTINGS }
  }
  return {
    kerf: pick(v.kerf, isNonNegative, DEFAULT_SETTINGS.kerf, fx),
    trim: pick(v.trim, isNonNegative, DEFAULT_SETTINGS.trim, fx),
    allowance: pick(v.allowance, isNonNegative, DEFAULT_SETTINGS.allowance, fx),
    cutMode: pick(v.cutMode, (x): x is CutMode => CUT_MODES.includes(x as CutMode), DEFAULT_SETTINGS.cutMode, fx),
  }
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
  }
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

function sanitizeClearance(v: unknown, fx: Fixes): Partial<Record<Axis, number>> {
  if (v === undefined || v === null) return {}
  if (!isRecord(v)) {
    fx.count++
    return {}
  }
  const out: Partial<Record<Axis, number>> = {}
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    if (isAxis(k) && isNonNegative(x)) out[k] = x
    else fx.count++
  }
  return out
}

/** 部材。id・名前が読めない部材は外す（null）。ほかの値は初期値に直す */
function sanitizePart(v: unknown, boardIds: ReadonlySet<string>, fx: Fixes): Part | null {
  if (!isRecord(v) || !isId(v.id) || typeof v.name !== 'string') return null
  const boardId =
    v.boardId === null || v.boardId === undefined
      ? null
      : typeof v.boardId === 'string' && boardIds.has(v.boardId)
        ? v.boardId
        : (fx.count++, null)
  return {
    id: v.id,
    name: v.name.trim(),
    boardId,
    expr: sanitizeExpr(v.expr, fx),
    thicknessAxis: v.thicknessAxis === null ? null : pick(v.thicknessAxis, isAxis, null, fx),
    quantity: pick(v.quantity, (x): x is number => Number.isInteger(x) && (x as number) >= 0, 1, fx),
    grain: pick(v.grain, (x): x is PartGrain => x === 'any' || isAxis(x), 'any', fx),
    clearance: sanitizeClearance(v.clearance, fx),
    allowance: v.allowance === null || v.allowance === undefined ? null : pick(v.allowance, isNonNegative, null, fx),
  }
}

/** 仕事。id が読めない仕事は外す（null） */
function sanitizeJob(v: unknown, fx: Fixes): Job | null {
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

  const boardIds = new Set(boards.map((b) => b.id))
  const parts: Part[] = []
  if (!Array.isArray(v.parts)) fx.count++
  for (const raw of Array.isArray(v.parts) ? v.parts : []) {
    const p = sanitizePart(raw, boardIds, fx)
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
  return {
    id: v.id,
    name,
    settings: sanitizeSettings(v.settings, fx),
    boards,
    parts,
    createdAt: pick(v.createdAt, isDate, fallbackDate, fx),
    updatedAt: pick(v.updatedAt, isDate, fallbackDate, fx),
  }
}

/** 仕事の一覧を検査し、読めるものだけを返す。fixes は直した・外した数 */
export function sanitizeJobs(list: readonly unknown[]): { jobs: Job[]; fixes: number } {
  const fx: Fixes = { count: 0 }
  const jobs: Job[] = []
  for (const raw of list) {
    const job = sanitizeJob(raw, fx)
    if (!job || jobs.some((j) => j.id === job.id)) fx.count++
    else jobs.push(job)
  }
  return { jobs, fixes: fx.count }
}

/** 保存データの外側（版と仕事の配列）が読めれば、その配列。読めなければ null */
function parseJobList(raw: string): unknown[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.jobs)) return null
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
  try {
    raw = storage.getItem(JOBS_KEY)
    current = storage.getItem(CURRENT_JOB_KEY)
  } catch {
    return { status: 'error', data: { ...EMPTY }, message: '保存データを読めませんでした', canSave: false }
  }
  if (raw === null) return { status: 'empty', data: { jobs: [], currentJobId: null } }
  const list = parseJobList(raw)
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
  const { jobs, fixes } = sanitizeJobs(list)
  const currentJobId = current !== null && jobs.some((j) => j.id === current) ? current : null
  if (fixes === 0) return { status: 'ok', data: { jobs, currentJobId } }
  const canSave = backupBroken(storage, raw, now)
  return {
    status: 'repaired',
    data: { jobs, currentJobId },
    message: canSave
      ? '保存データの一部が読めなかったので、読めるところだけ読み込みました（元のデータは別の場所に残してあります）'
      : '保存データの一部が読めなかったので、読めるところだけ読み込みました（データを守るため、このままでは保存しません）',
    canSave,
  }
}

/** 仕事の一覧と開いている仕事の id を書く。例外は投げない */
export function saveSaved(storage: KeyValueStorage | null, data: SavedData): SaveResult {
  if (!storage) return { ok: false, message: 'この端末では保存が使えません' }
  try {
    storage.setItem(JOBS_KEY, JSON.stringify({ version: 1, jobs: data.jobs }))
    storage.setItem(CURRENT_JOB_KEY, data.currentJobId ?? '')
    return { ok: true }
  } catch {
    return { ok: false, message: '保存できませんでした（端末の空き容量などを確かめてください）' }
  }
}

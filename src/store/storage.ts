// localStorage への保存と読み込み。読み書きはすべて try/catch で囲み、失敗しても例外を外に出さない
import { defaultNige, defaultSettings } from '../engine/defaults'
import { validatePartName } from '../engine/formula/tokenize'
import { migrateClearanceChecked, type LegacyJob, type LegacyPart } from '../engine/migrate/clearance'
import { eq1 } from '../engine/round'
import {
  AXES,
  DEFAULT_SETTINGS,
  type Axis,
  type Board,
  type BoardSizeKind,
  type CutMode,
  type Job,
  type Nige,
  type PartGrain,
} from '../engine/types'
import { newId } from './jobs'
import { defaultTemplate, templateOf, type MaterialSpec, type SettingsTemplate } from './template'

/** 最後に使った設定（ひな形）のキー（{ version: 1, template }） */
export const TEMPLATE_KEY = 'kidori.lastSettings.v1'

/** 保存データ第2版のキー（{ version: 2, jobs }） */
export const JOBS_KEY = 'kidori.jobs.v2'
/**
 * 以前の版（第1版）のキー。第2版が無いときだけ読み、移し替えて第2版に書く。
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

interface Fixes {
  count: number
  /**
   * 読んでいるデータの版。第1版には逃げ・メモ・チェックが無いのが当たり前なので、無くても直した数に数えない
   */
  version: 1 | 2
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
 * 逃げ。配列でなければ初期値（第1版で無いときは undefined にして、移し替えで初期値を入れる）。
 * id が空・前の逃げと同じ、値が 0 以下・数でない・前の逃げと同じ寸法のものは外す。
 * 寸法は丸めずに比べる（以前の版から移した 0.25 と 0.3 は別の逃げとして残す）
 */
function sanitizeNige(v: unknown, fx: Fixes): Nige[] | undefined {
  if (v === undefined && fx.version === 1) return undefined
  if (!Array.isArray(v)) {
    fx.count++
    return defaultNige()
  }
  const out: Nige[] = []
  for (const x of v) {
    const good =
      isRecord(x) &&
      isId(x.id) &&
      isPositive(x.value) &&
      !out.some((n) => n.id === x.id || Math.abs(n.value - (x.value as number)) < 1e-9)
    if (good) out.push({ id: x.id as string, value: x.value as number })
    else fx.count++
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

/** 部材。id・名前が読めない部材は外す（null）。ほかの値は初期値に直す */
function sanitizePart(v: unknown, boardIds: ReadonlySet<string>, fx: Fixes): LegacyPart | null {
  if (!isRecord(v) || !isId(v.id) || typeof v.name !== 'string') return null
  const boardId =
    v.boardId === null || v.boardId === undefined
      ? null
      : typeof v.boardId === 'string' && boardIds.has(v.boardId)
        ? v.boardId
        : (fx.count++, null)
  const v2 = fx.version === 2
  const memo = typeof v.memo === 'string' ? v.memo : (v2 && fx.count++, '')
  const checkOk = isRecord(v.checks) && typeof v.checks.finished === 'boolean' && typeof v.checks.cut === 'boolean'
  if (v2 && !checkOk) fx.count++
  const clearance = sanitizeClearance(v.clearance)
  return {
    id: v.id,
    name: v.name.trim(),
    boardId,
    expr: sanitizeExpr(v.expr, fx),
    thicknessAxis: v.thicknessAxis === null ? null : pick(v.thicknessAxis, isAxis, null, fx),
    quantity: pick(v.quantity, (x): x is number => Number.isInteger(x) && (x as number) >= 0, 1, fx),
    grain: pick(v.grain, (x): x is PartGrain => x === 'any' || isAxis(x), 'any', fx),
    memo,
    checks: {
      finished: isRecord(v.checks) && v.checks.finished === true,
      cut: isRecord(v.checks) && v.checks.cut === true,
    },
    allowance: v.allowance === null || v.allowance === undefined ? null : pick(v.allowance, isNonNegative, null, fx),
    ...(clearance ? { clearance } : {}),
  }
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

  const boardIds = new Set(boards.map((b) => b.id))
  const parts: LegacyPart[] = []
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

/**
 * 仕事の一覧を検査し、読めるものだけを返す。fixes は直した・外した数。
 * 以前の版の部材ごとの逃げは migrateClearance で設定の逃げ＋式に移す（第2版に古い形が混ざっていても同じ。寸法は変わらない）
 */
export function sanitizeJobs(
  list: readonly unknown[],
  version: 1 | 2 = 2,
): { jobs: Job[]; fixes: number; changed: string[] } {
  const fx: Fixes = { count: 0, version }
  const jobs: Job[] = []
  const changed: string[] = []
  for (const raw of list) {
    const legacy = sanitizeJob(raw, fx)
    if (!legacy || jobs.some((j) => j.id === legacy.id)) {
      fx.count++
      continue
    }
    const m = migrateClearanceChecked(legacy, () => newId('nige'))
    jobs.push(m.job)
    if (m.changed.length > 0) changed.push(`${m.job.name}の ${m.changed.map((c) => c.name).join('・')}`)
  }
  return { jobs, fixes: fx.count, changed }
}

/** 移し替えで寸法が変わった部材の知らせ。無ければ null */
function changedMessage(changed: readonly string[]): string | null {
  if (changed.length === 0) return null
  return `以前の版から移したときに寸法が変わった部材：${changed.join('、')}（寸法表で確かめてください）`
}

/** 保存データの外側（版と仕事の配列）が読めれば、その配列。読めなければ null */
function parseJobList(raw: string, version: 1 | 2): unknown[] | null {
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
  let version: 1 | 2 = 2
  try {
    raw = storage.getItem(JOBS_KEY)
    current = storage.getItem(CURRENT_JOB_KEY)
    if (raw === null) {
      // 第2版が無ければ、以前の版を読んで移し替える（以前の版のキーはそのまま残す）
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
  const notice = changedMessage(sanitized.changed)
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

/** 仕事の一覧と開いている仕事の id を第2版のキーに書く。以前の版のキーには触らない。例外は投げない */
export function saveSaved(storage: KeyValueStorage | null, data: SavedData): SaveResult {
  if (!storage) return { ok: false, message: 'この端末では保存が使えません' }
  try {
    storage.setItem(JOBS_KEY, JSON.stringify({ version: 2, jobs: data.jobs }))
    storage.setItem(CURRENT_JOB_KEY, data.currentJobId ?? '')
    return { ok: true }
  } catch {
    return { ok: false, message: '保存できませんでした（端末の空き容量などを確かめてください）' }
  }
}

// ---------- 最後に使った設定（ひな形） ----------

/** ひな形の材料。材料名が空・厚みが 0 以下・材料名＋厚みの重複は外す */
function sanitizeMaterials(v: unknown): MaterialSpec[] {
  if (!Array.isArray(v)) return defaultTemplate().materials
  const out: MaterialSpec[] = []
  for (const m of v) {
    if (!isRecord(m) || typeof m.material !== 'string' || !isPositive(m.thickness)) continue
    const material = m.material.trim()
    if (!material) continue
    const thickness = m.thickness
    const key = material.normalize('NFKC')
    if (out.some((x) => x.material.normalize('NFKC') === key && eq1(x.thickness, thickness))) continue
    const spec: MaterialSpec = { material, thickness }
    if (m.builtIn === true) spec.builtIn = true
    out.push(spec)
  }
  return out
}

/**
 * 最後に使った設定を読む。例外は投げない。
 * キーが無ければ：仕事が無ければ初期値、仕事があれば更新日が一番新しい仕事の設定。読めなければ初期値
 */
export function loadTemplate(storage: KeyValueStorage | null, jobs: readonly Job[]): SettingsTemplate {
  let raw: string | null = null
  try {
    raw = storage ? storage.getItem(TEMPLATE_KEY) : null
  } catch {
    return defaultTemplate()
  }
  if (raw === null) {
    if (jobs.length === 0) return defaultTemplate()
    const newest = jobs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    return templateOf(newest)
  }
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.version !== 1 || !isRecord(data.template)) return defaultTemplate()
    const fx: Fixes = { count: 0, version: 2 }
    const settings = sanitizeSettings(data.template.settings, fx)
    return {
      settings: { ...settings, nige: settings.nige ?? defaultNige() },
      materials: sanitizeMaterials(data.template.materials),
    }
  } catch {
    return defaultTemplate()
  }
}

/** 最後に使った設定を書く。例外は投げない */
export function saveTemplate(storage: KeyValueStorage | null, template: SettingsTemplate): SaveResult {
  if (!storage) return { ok: false, message: 'この端末では保存が使えません' }
  try {
    storage.setItem(TEMPLATE_KEY, JSON.stringify({ version: 1, template }))
    return { ok: true }
  } catch {
    return { ok: false, message: '保存できませんでした（端末の空き容量などを確かめてください）' }
  }
}

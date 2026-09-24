// localStorage への保存と読み込み。読み書きはすべて try/catch で囲み、失敗しても例外を外に出さない
import type { Job } from '../engine/types'

export const JOBS_KEY = 'kidori.jobs.v1'
export const CURRENT_JOB_KEY = 'kidori.currentJobId'
/** 読めなかった保存データを退避しておくキー（元のデータを失わないため） */
export const BROKEN_BACKUP_KEY = 'kidori.jobs.v1.broken'

/** localStorage のうち使う部分。テストでは差し替える */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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

/** 仕事として最低限の形をしているか（中身の細かい検査はしない） */
function looksLikeJob(v: unknown): v is Job {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    isRecord(v.settings) &&
    Array.isArray(v.boards) &&
    Array.isArray(v.parts)
  )
}

function parseJobs(raw: string): Job[] | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.jobs)) return null
  if (!data.jobs.every(looksLikeJob)) return null
  return data.jobs
}

/** 仕事の一覧と開いている仕事の id を読む。例外は投げない */
export function loadSaved(storage: KeyValueStorage | null): LoadResult {
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
  const jobs = parseJobs(raw)
  if (!jobs) {
    let canSave = false
    try {
      storage.setItem(BROKEN_BACKUP_KEY, raw)
      canSave = true
    } catch {
      canSave = false
    }
    return {
      status: 'error',
      data: { ...EMPTY },
      message: canSave
        ? '保存データを読めませんでした（読めなかったデータは別の場所に残してあります）'
        : '保存データを読めませんでした（データを守るため、このままでは保存しません）',
      canSave,
    }
  }
  const currentJobId = current !== null && jobs.some((j) => j.id === current) ? current : null
  return { status: 'ok', data: { jobs, currentJobId } }
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

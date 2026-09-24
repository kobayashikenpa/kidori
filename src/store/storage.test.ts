import { describe, expect, it } from 'vitest'
import { bookshelfJob } from '../engine/fixtures/bookshelf'
import {
  BROKEN_BACKUP_KEY,
  CURRENT_JOB_KEY,
  JOBS_KEY,
  loadSaved,
  saveSaved,
  type KeyValueStorage,
} from './storage'

function memoryStorage(init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('保存と読み込み', () => {
  it('見本を保存して読み込むと同じ内容に戻る', () => {
    const s = memoryStorage()
    const job = bookshelfJob()
    expect(saveSaved(s, { jobs: [job], currentJobId: job.id })).toEqual({ ok: true })
    const r = loadSaved(s)
    expect(r.status).toBe('ok')
    expect(r.data).toEqual({ jobs: [bookshelfJob()], currentJobId: job.id })
  })

  it('何も保存されていなければ empty', () => {
    expect(loadSaved(memoryStorage())).toEqual({ status: 'empty', data: { jobs: [], currentJobId: null } })
  })

  it('開いている仕事の id が一覧に無ければ null にする', () => {
    const s = memoryStorage()
    saveSaved(s, { jobs: [bookshelfJob()], currentJobId: 'nothing' })
    expect(loadSaved(s).data.currentJobId).toBeNull()
  })

  it('localStorage が例外を投げても落ちずに、空の一覧とエラーの印を返す', () => {
    const r = loadSaved(throwing)
    expect(r.status).toBe('error')
    expect(r.data.jobs).toEqual([])
    if (r.status === 'error') expect(r.canSave).toBe(false)
    expect(saveSaved(throwing, { jobs: [], currentJobId: null }).ok).toBe(false)
  })

  it('localStorage が無い環境でも落ちない', () => {
    expect(loadSaved(null).status).toBe('error')
    expect(saveSaved(null, { jobs: [], currentJobId: null }).ok).toBe(false)
  })

  it('壊れた JSON は読まずにエラーの印を返し、元のデータを退避して上書きしない', () => {
    const s = memoryStorage({ [JOBS_KEY]: '{"version":1,"jobs":[', [CURRENT_JOB_KEY]: 'x' })
    const r = loadSaved(s)
    expect(r.status).toBe('error')
    expect(r.data).toEqual({ jobs: [], currentJobId: null })
    expect(s.map.get(JOBS_KEY)).toBe('{"version":1,"jobs":[')
    expect(s.map.get(BROKEN_BACKUP_KEY)).toBe('{"version":1,"jobs":[')
    if (r.status === 'error') expect(r.canSave).toBe(true)
  })

  it('形の違うデータ（版が違う・仕事の形でない）もエラーにする', () => {
    expect(loadSaved(memoryStorage({ [JOBS_KEY]: '{"version":2,"jobs":[]}' })).status).toBe('error')
    expect(loadSaved(memoryStorage({ [JOBS_KEY]: '{"version":1,"jobs":[{"id":1}]}' })).status).toBe('error')
    expect(loadSaved(memoryStorage({ [JOBS_KEY]: 'null' })).status).toBe('error')
  })

  it('壊れたデータを退避できないときは、保存してはいけない印を返す', () => {
    const map = new Map([[JOBS_KEY, 'broken']])
    const s: KeyValueStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const r = loadSaved(s)
    expect(r.status === 'error' && r.canSave).toBe(false)
  })
})

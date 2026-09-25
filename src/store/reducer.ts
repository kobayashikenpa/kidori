// 仕事データの状態と、その変え方（reducer）。React に依存しないのでテストしやすい
import type { Job } from '../engine/types'
import { deleteJob, type JobOp } from './jobs'
import type { LoadResult } from './storage'

export interface StoreState {
  jobs: Job[]
  /** 開いている仕事。null なら開いていない */
  currentJobId: string | null
  /** 読み込みに失敗したときの知らせ（画面の上に出す） */
  loadError: string | null
  /** 保存してよいか（壊れたデータを守るため、保存を止めることがある） */
  canSave: boolean
}

export type StoreAction =
  /** 仕事を一覧に足す。open なら開く */
  | { type: 'addJob'; job: Job; open: boolean }
  /** 仕事を開く（null で閉じる） */
  | { type: 'openJob'; id: string | null }
  /** 仕事を消す。開いていた仕事なら、何も開いていない状態にする */
  | { type: 'removeJob'; id: string }
  /** 仕事に操作を当てる。失敗した操作は何も変えない。now は更新日時（ISO 文字列） */
  | { type: 'applyOp'; jobId: string; op: JobOp; now: string }

/** 読み込みの結果から最初の状態を作る。何も保存されていなければ、仕事が1つもない空の状態で始める（仕様書 10） */
export function initialState(load: LoadResult): StoreState {
  if (load.status === 'empty') {
    return { jobs: [], currentJobId: null, loadError: null, canSave: true }
  }
  if (load.status === 'error' || load.status === 'repaired') {
    return { ...load.data, loadError: load.message, canSave: load.canSave }
  }
  return { ...load.data, loadError: null, canSave: true }
}

export function storeReducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'addJob':
      return {
        ...state,
        jobs: [...state.jobs.filter((j) => j.id !== action.job.id), action.job],
        currentJobId: action.open ? action.job.id : state.currentJobId,
      }
    case 'openJob':
      if (action.id !== null && !state.jobs.some((j) => j.id === action.id)) return state
      return { ...state, currentJobId: action.id }
    case 'removeJob':
      return { ...state, ...deleteJob(state.jobs, state.currentJobId, action.id) }
    case 'applyOp': {
      const job = state.jobs.find((j) => j.id === action.jobId)
      if (!job) return state
      const r = action.op(job)
      if (!r.ok) return state
      const next = { ...r.job, updatedAt: action.now }
      return { ...state, jobs: state.jobs.map((j) => (j.id === action.jobId ? next : j)) }
    }
  }
}

/** 開いている仕事（無ければ null） */
export function currentJob(state: StoreState): Job | null {
  return state.jobs.find((j) => j.id === state.currentJobId) ?? null
}

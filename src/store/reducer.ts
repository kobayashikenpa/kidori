// 仕事データの状態と、その変え方（reducer）。React に依存しないのでテストしやすい
import type { Job } from '../engine/types'
import { deleteJob, type JobOp, type OpResult } from './jobs'
import type { LoadResult } from './storage'

export interface StoreState {
  jobs: Job[]
  /** 開いている仕事。null なら開いていない */
  currentJobId: string | null
  /** 読み込みに失敗したとき・以前の版から移して寸法が変わった部材があるときの知らせ（画面の上に出す） */
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
  /**
   * 操作を当てた後の仕事で置き換える。now は更新日時（ISO 文字列）。
   * 操作（JobOp）そのものは渡さない：React は reducer を2回以上呼ぶことがあり、
   * 操作の中で id を作る（addNige など）と呼ぶたびに別の id になってずれるため。
   * 操作は applyOp で1回だけ当て、その結果をこのアクションで渡す
   */
  | { type: 'setJob'; jobId: string; job: Job; now: string }

/** 読み込みの結果から最初の状態を作る。何も保存されていなければ、仕事が1つもない空の状態で始める（仕様書 10） */
export function initialState(load: LoadResult): StoreState {
  if (load.status === 'empty') {
    return { jobs: [], currentJobId: null, loadError: null, canSave: true }
  }
  if (load.status === 'error' || load.status === 'repaired') {
    return { ...load.data, loadError: load.message, canSave: load.canSave }
  }
  return { ...load.data, loadError: load.message ?? null, canSave: true }
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
    case 'setJob': {
      if (!state.jobs.some((j) => j.id === action.jobId)) return state
      const next = { ...action.job, id: action.jobId, updatedAt: action.now }
      return { ...state, jobs: state.jobs.map((j) => (j.id === action.jobId ? next : j)) }
    }
  }
}

/**
 * 仕事に操作を1回だけ当てて、置き換えのアクションを作る。
 * 失敗したとき・仕事が無いときは理由を返す（action は null）
 */
export function applyOp(
  state: StoreState,
  jobId: string,
  op: JobOp,
  now: string,
): { result: OpResult; action: StoreAction | null } {
  const job = state.jobs.find((j) => j.id === jobId)
  if (!job) return { result: { ok: false, message: '仕事が見つかりません' }, action: null }
  const result = op(job)
  if (!result.ok) return { result, action: null }
  return { result, action: { type: 'setJob', jobId, job: result.job, now } }
}

/** 開いている仕事（無ければ null） */
export function currentJob(state: StoreState): Job | null {
  return state.jobs.find((j) => j.id === state.currentJobId) ?? null
}

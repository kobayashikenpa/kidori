// 画面から仕事データを使うためのフック
import { createContext, useContext } from 'react'
import type { Job } from '../engine/types'
import type { JobOp, OpResult } from './jobs'
import type { StoreState } from './reducer'

export interface JobStoreValue {
  state: StoreState
  /** 開いている仕事（無ければ null） */
  job: Job | null
  /** 開いている仕事に操作を当てる。失敗したら理由を返す（画面に出す） */
  run: (op: JobOp) => OpResult
  /** 指定した仕事に操作を当てる（一覧から名前を変えるときなど）。失敗したら理由を返す */
  runOn: (jobId: string, op: JobOp) => OpResult
  addJob: (job: Job, open: boolean) => void
  /** 仕事を消す。開いていた仕事なら、何も開いていない状態にする */
  removeJob: (id: string) => void
  openJob: (id: string | null) => void
  /** 保存に失敗したときの知らせ */
  saveError: string | null
}

export const JobStoreContext = createContext<JobStoreValue | null>(null)

export function useJobStore(): JobStoreValue {
  const v = useContext(JobStoreContext)
  if (!v) throw new Error('JobStoreProvider の中で使ってください')
  return v
}

/** 開いている仕事と操作。仕事を開いている画面でだけ使う */
export function useCurrentJob(): { job: Job; run: (op: JobOp) => OpResult } {
  const { job, run } = useJobStore()
  if (!job) throw new Error('仕事が開かれていません')
  return { job, run }
}

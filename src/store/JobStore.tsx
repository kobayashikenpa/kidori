// 仕事データの状態（useReducer）と、変わったときの自動保存
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Job } from '../engine/types'
import type { JobOp, OpResult } from './jobs'
import { currentJob, initialState, storeReducer, type StoreAction, type StoreState } from './reducer'
import { browserStorage, loadSaved, saveSaved } from './storage'
import { JobStoreContext, type JobStoreValue } from './useJobStore'

/** 入力中の連打をまとめて保存するまでの待ち時間 */
const SAVE_DELAY_MS = 300

function init(): StoreState {
  return initialState(loadSaved(browserStorage()))
}

export function JobStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(storeReducer, undefined, init)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 同じ操作の中で続けて run を呼んでも最新の状態に当てられるよう、状態を手元にも持つ
  const latest = useRef(state)

  const send = useCallback((action: StoreAction) => {
    latest.current = storeReducer(latest.current, action)
    dispatch(action)
  }, [])

  const run = useCallback(
    (op: JobOp): OpResult => {
      const s = latest.current
      const job = currentJob(s)
      if (!job) return { ok: false, message: '仕事が開かれていません' }
      const r = op(job)
      if (r.ok) send({ type: 'applyOp', jobId: job.id, op, now: new Date().toISOString() })
      return r
    },
    [send],
  )
  const addJob = useCallback((job: Job, open: boolean) => send({ type: 'addJob', job, open }), [send])
  const openJob = useCallback((id: string | null) => send({ type: 'openJob', id }), [send])

  // 自動保存：状態が変わったら少し待ってから書く。画面を閉じるときはすぐ書く
  const { jobs, currentJobId, canSave } = state
  useEffect(() => {
    if (!canSave) return
    const save = () => {
      const r = saveSaved(browserStorage(), { jobs, currentJobId })
      setSaveError(r.ok ? null : r.message)
    }
    const timer = setTimeout(save, SAVE_DELAY_MS)
    const onHide = () => {
      clearTimeout(timer)
      save()
    }
    window.addEventListener('pagehide', onHide)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', onHide)
    }
  }, [jobs, currentJobId, canSave])

  const value = useMemo<JobStoreValue>(
    () => ({ state, job: currentJob(state), run, addJob, openJob, saveError }),
    [state, run, addJob, openJob, saveError],
  )
  return <JobStoreContext.Provider value={value}>{children}</JobStoreContext.Provider>
}

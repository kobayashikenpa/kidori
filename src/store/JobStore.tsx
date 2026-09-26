// 仕事データの状態（useReducer）と、変わったときの自動保存
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Job } from '../engine/types'
import type { JobOp, OpResult } from './jobs'
import { applyOp, currentJob, initialState, storeReducer, type StoreAction, type StoreState } from './reducer'
import { browserStorage, loadSaved, loadTemplate, saveSaved, saveTemplate } from './storage'
import { JobStoreContext, type JobStoreValue } from './useJobStore'

/** 入力中の連打をまとめて保存するまでの待ち時間 */
const SAVE_DELAY_MS = 300

function init(): StoreState {
  const storage = browserStorage()
  const load = loadSaved(storage)
  return initialState(load, loadTemplate(storage, load.data.jobs))
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

  const runOn = useCallback(
    (jobId: string, op: JobOp): OpResult => {
      // 操作はここで1回だけ当て、結果の仕事を渡す（reducer の中で操作をやり直すと、作った id がずれる）
      const { result, action } = applyOp(latest.current, jobId, op, new Date().toISOString())
      if (action) send(action)
      return result
    },
    [send],
  )
  const run = useCallback(
    (op: JobOp): OpResult => {
      const job = currentJob(latest.current)
      if (!job) return { ok: false, message: '仕事が開かれていません' }
      return runOn(job.id, op)
    },
    [runOn],
  )
  const addJob = useCallback((job: Job, open: boolean) => send({ type: 'addJob', job, open }), [send])
  const openJob = useCallback((id: string | null) => send({ type: 'openJob', id }), [send])
  const removeJob = useCallback((id: string) => send({ type: 'removeJob', id }), [send])

  // 自動保存：状態が変わったら少し待ってから書く。画面を閉じるときはすぐ書く
  const { jobs, currentJobId, canSave, template } = state
  useEffect(() => {
    if (!canSave) return
    const save = () => {
      const storage = browserStorage()
      const r = saveSaved(storage, { jobs, currentJobId })
      const t = saveTemplate(storage, template)
      setSaveError(!r.ok ? r.message : !t.ok ? t.message : null)
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
  }, [jobs, currentJobId, canSave, template])

  const value = useMemo<JobStoreValue>(
    () => ({ state, job: currentJob(state), run, runOn, addJob, removeJob, openJob, saveError }),
    [state, run, runOn, addJob, removeJob, openJob, saveError],
  )
  return <JobStoreContext.Provider value={value}>{children}</JobStoreContext.Provider>
}

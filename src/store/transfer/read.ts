// ファイルから取り込む：1つの入口（第2.4版。architecture.md 16.2）。例外を投げない
import type { Job } from '../../engine/types'
import { changedMessage, sanitizeJobs, sanitizeTemplate } from '../storage'
import type { SettingsTemplate } from '../template'
import { checkEnvelope, MAX_TRANSFER_SIZE, PARTIAL_NOTICE, READ_FAILED } from './envelope'
import { shareSummary } from './share'

export type TransferRead =
  | { ok: true; kind: 'share'; job: Job; summary: { rows: number; count: number }; notice?: string }
  | { ok: true; kind: 'backup'; jobs: Job[]; template: SettingsTemplate | null; notice?: string }
  | { ok: false; message: string }

const failed: TransferRead = { ok: false, message: READ_FAILED }

/** 一部直した・移し替えで寸法が変わったときの添え書き。無ければ undefined */
function noticeOf(fixes: number, changed: readonly string[]): string | undefined {
  const parts = [fixes > 0 ? PARTIAL_NOTICE : null, changedMessage(changed)].filter((x): x is string => x !== null)
  return parts.length > 0 ? parts.join('。') : undefined
}

/**
 * 選んだファイルの中身（文字列）を読む。JSON → 外側の検査 → kind で分ける → sanitizeJobs（今の読み込みと同じ検査・修復・移し替え）。
 * 空・JSON でない・外側が違う・中の仕事が1つも読めない・20MB 超は「読み込めませんでした」。知らない版は「新しい版」の文言
 */
export function readTransferFile(text: string): TransferRead {
  try {
    if (typeof text !== 'string' || text.length > MAX_TRANSFER_SIZE || text.trim() === '') return failed
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return failed
    }
    const env = checkEnvelope(data)
    if (!env.ok) return env
    if (env.kind === 'share') {
      const raw = env.data.job
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return failed
      const r = sanitizeJobs([raw], env.dataVersion)
      const job = r.jobs[0]
      if (!job) return failed
      const notice = noticeOf(r.fixes, r.changed)
      return { ok: true, kind: 'share', job, summary: shareSummary(job), ...(notice ? { notice } : {}) }
    }
    const list = env.data.jobs
    if (!Array.isArray(list)) return failed
    const r = sanitizeJobs(list, env.dataVersion)
    if (r.jobs.length === 0) return failed
    const notice = noticeOf(r.fixes, r.changed)
    return { ok: true, kind: 'backup', jobs: r.jobs, template: sanitizeTemplate(env.data.template), ...(notice ? { notice } : {}) }
  } catch {
    return failed
  }
}

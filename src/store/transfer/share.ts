// 共有のファイル（この仕事を送る・ファイルから取り込む。第2.4版。architecture.md 16.4）。React・ブラウザに依存しない
import { jobRefIds } from '../../engine/formula/usages'
import type { Job } from '../../engine/types'
import { copyName, newId, rekeyJob } from '../jobs'
import { envelope, type ShareFile } from './envelope'

/** 確認に出す中身：部材の行の数（枚数0の行も数える）と枚数の合計。見本は 5種類・9枚 */
export function shareSummary(job: Pick<Job, 'parts'>): { rows: number; count: number } {
  return { rows: job.parts.length, count: job.parts.reduce((sum, p) => sum + p.quantity, 0) }
}

/**
 * 送る仕事の中身：使っている材料・フラッシュ・逃げと、2つの材料とも残した組の行だけ。
 * 固定した1枚は入れず、部材のチェックは全部 false（cutByBoard なし）。メモ・手持ち・設定の数値・id はそのまま。元の仕事は変えない
 */
function shareJob(job: Job): Job {
  const refs = jobRefIds(job)
  const boards = job.boards.filter((b) => refs.boardIds.has(b.id))
  return {
    ...job,
    settings: { ...job.settings, nige: job.settings.nige.filter((n) => refs.nigeIds.has(n.id)) },
    boards,
    flushes: job.flushes.filter((f) => refs.flushIds.has(f.id)),
    parts: job.parts.map((p) => ({ ...p, checks: { finished: false, cut: false } })),
    frozenSheets: [],
    stackSheets: job.stackSheets.filter((s) => s.boardIds.every((id) => refs.boardIds.has(id))),
  }
}

/** 共有のファイルの中身（JSON の文字列。空白なし） */
export function buildShareFile(job: Job, now: Date): string {
  const file: ShareFile = { ...envelope('share', now), job: shareJob(job) }
  return JSON.stringify(file)
}

/** ファイル名に使えない文字（\ / : * ? " < > |）・制御文字・空白（半角・全角） */
// oxlint-disable-next-line no-control-regex
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f\s]/gu
/** ファイル名の名前の部分の長さ（暫定。未決事項 52） */
const MAX_NAME_LENGTH = 50

/** 共有のファイル名：`<仕事の名前>.kidori.json`（空白・使えない文字を除く、50 文字まで）。除いて空なら kidori-仕事.kidori.json */
export function shareFileName(job: Pick<Job, 'name'>): string {
  const base = Array.from(job.name.replace(BAD_CHARS, '')).slice(0, MAX_NAME_LENGTH).join('')
  return `${base || 'kidori-仕事'}.kidori.json`
}

/**
 * 共有された仕事を取り込む写し：id は全部新しく（rekeyJob・frozen: false）、固定した1枚・チェックは無し。
 * 名前は同じ名前の仕事が無ければそのまま、あれば「のコピー」。作成日・更新日は取り込んだ時刻
 */
export function importShared(job: Job, existingNames: readonly string[], now: Date): Job {
  const t = now.toISOString()
  const out = rekeyJob(job, { job: newId('job'), next: newId }, { frozen: false })
  const taken = existingNames.some((n) => n.trim() === job.name.trim())
  return {
    ...out,
    name: taken ? copyName(job.name, existingNames) : job.name,
    parts: out.parts.map((p) => ({ ...p, checks: { finished: false, cut: false } })),
    createdAt: t,
    updatedAt: t,
  }
}

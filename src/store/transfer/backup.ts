// バックアップのファイル（第2.4版。architecture.md 16.5）。React・ブラウザに依存しない
import type { Job } from '../../engine/types'
import { copyName, newId, rekeyJob } from '../jobs'
import type { StoreState } from '../reducer'
import type { SettingsTemplate } from '../template'
import { envelope, type BackupFile } from './envelope'

/** バックアップのファイルの中身（JSON の文字列。空白なし）：全部の仕事そのまま（固定した1枚・チェック・手持ちも）とひな形 */
export function buildBackup(state: Pick<StoreState, 'jobs' | 'template'>, now: Date): string {
  const file: BackupFile = { ...envelope('backup', now), jobs: state.jobs, template: state.template }
  return JSON.stringify(file)
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** バックアップのファイル名：kidori-バックアップ-2026-09-28.json（端末の日付） */
export function backupFileName(now: Date): string {
  return `kidori-バックアップ-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.json`
}

/**
 * バックアップを取り込む写しを作る（state は変えない。画面は jobs を addJobs（open: false）で1回で足し、template があれば setTemplate する）。
 * - 仕事ごとに id を全部新しく（rekeyJob・frozen: true。切り出しの記録も戻す）。作成日・更新日はファイルのまま
 * - 名前は同じ名前があれば「のコピー」（足す仕事どうしでも重ならないように順に数える）
 * - template：今の仕事が1つも無いときだけファイルのひな形（ファイルが null なら null）。仕事があれば null（変えない）
 * - now は使わない（日付はファイルのまま）。呼び方をほかの取り込みとそろえるために受け取る
 */
export function importBackup(
  state: Pick<StoreState, 'jobs'>,
  read: { jobs: readonly Job[]; template: SettingsTemplate | null },
  _now: Date,
): { jobs: Job[]; template: SettingsTemplate | null; message: string } {
  const names = state.jobs.map((j) => j.name)
  const jobs = read.jobs.map((job) => {
    const out = rekeyJob(job, { job: newId('job'), next: newId }, { frozen: true })
    const taken = names.some((n) => n.trim() === job.name.trim())
    const name = taken ? copyName(job.name, names) : job.name
    names.push(name)
    return { ...out, name }
  })
  return {
    jobs,
    template: state.jobs.length === 0 ? read.template : null,
    message: `${jobs.length}件の仕事を追加しました`,
  }
}

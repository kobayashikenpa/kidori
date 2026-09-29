// 共有・バックアップのファイルの外側の形と検査（第2.4版。architecture.md 16.2）。React・ブラウザに依存しない
import type { Job } from '../../engine/types'

/** 外側の形の版（このファイルの形）。形を変えたら上げる。古い数の読み方は消さない */
export const TRANSFER_VERSION = 1
/** 中の仕事の形の版（= 保存データの版。第2.5版で 3。1・2 のファイルも読んで移し替える） */
export const TRANSFER_DATA_VERSION = 3
/** 読む文字列の大きさの上限（20MB） */
export const MAX_TRANSFER_SIZE = 20 * 1024 * 1024

export const READ_FAILED = '読み込めませんでした'
export const NEWER_VERSION = '新しい版のアプリで作られたので読み込めません。アプリを開き直して新しくしてください'
export const PARTIAL_NOTICE = '一部読めないところがあったので、読めるところだけ追加します'

export type TransferKind = 'share' | 'backup'

export interface Envelope {
  app: 'kidori'
  kind: TransferKind
  version: 1
  dataVersion: 1 | 2 | 3
  exportedAt: string
}

export interface ShareFile extends Envelope {
  kind: 'share'
  job: Job
}

export interface BackupFile extends Envelope {
  kind: 'backup'
  jobs: Job[]
  /** 第2.4版〜第2.5版のファイルにある「最後に使った設定（ひな形）」。第2.5.1版からは書かず、読んでも使わない */
  template?: unknown
}

/** 書き出すときの外側（exportedAt は now の ISO） */
export function envelope<K extends TransferKind>(kind: K, now: Date): Envelope & { kind: K } {
  return { app: 'kidori', kind, version: TRANSFER_VERSION, dataVersion: TRANSFER_DATA_VERSION, exportedAt: now.toISOString() }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 知らない（今より新しい）版の数か */
const isNewer = (v: unknown, current: number) => typeof v === 'number' && Number.isInteger(v) && v > current

/**
 * 外側を検査する。読めれば kind・dataVersion と中身のオブジェクト、読めなければ理由（画面に出す文言）。
 * app → version → dataVersion → kind の順に見る（新しい版のファイルは、知らない kind でも「新しい版」と知らせる）
 */
export function checkEnvelope(
  data: unknown,
): { ok: true; kind: TransferKind; dataVersion: 1 | 2 | 3; data: Record<string, unknown> } | { ok: false; message: string } {
  if (!isRecord(data) || data.app !== 'kidori') return { ok: false, message: READ_FAILED }
  if (isNewer(data.version, TRANSFER_VERSION)) return { ok: false, message: NEWER_VERSION }
  if (data.version !== 1) return { ok: false, message: READ_FAILED }
  if (isNewer(data.dataVersion, TRANSFER_DATA_VERSION)) return { ok: false, message: NEWER_VERSION }
  if (data.dataVersion !== 1 && data.dataVersion !== 2 && data.dataVersion !== 3) return { ok: false, message: READ_FAILED }
  if (data.kind !== 'share' && data.kind !== 'backup') return { ok: false, message: READ_FAILED }
  return { ok: true, kind: data.kind, dataVersion: data.dataVersion, data }
}

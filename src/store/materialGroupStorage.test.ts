// S-28：保存データ第3版と、以前の芯材（core）の移し替え（読み込み・見本・共有／バックアップのファイル）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, SAMPLE_FLUSH_ID, sampleGroupJob } from '../engine/fixtures/flush'
import { legacySampleFlushJob, toLegacyJob, type LegacyJob } from '../engine/fixtures/legacyFlush'
import { flushThickness } from '../engine/flush'
import { packJob } from '../engine/packing'
import { frozenSheetViews, materialSummaries } from '../engine/progress/frozen'
import type { Job } from '../engine/types'
import { copyJob, setPieceCheck, type OpResult } from './jobs'
import { sampleJob } from './sample'
import {
  CURRENT_JOB_KEY,
  JOBS_KEY,
  JOBS_V2_KEY,
  loadSaved,
  saveSaved,
  type KeyValueStorage,
} from './storage'
import { buildBackup } from './transfer/backup'
import { NEWER_VERSION } from './transfer/envelope'
import { readTransferFile } from './transfer/read'
import { buildShareFile } from './transfer/share'
import shareV1 from './transfer/fixtures/share-v1.kidori.json?raw'
import backupV1 from './transfer/fixtures/backup-v1.json?raw'
import shareV3 from './transfer/fixtures/share-v3.kidori.json?raw'
import { dropAddedBuiltIns } from './fixtures/builtIns'

const NOW = new Date('2026-09-29T10:00:00.000Z')
const pct = (r: number) => Math.round(r * 1000) / 10

function memoryStorage(init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}
const ok = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

/** 第2.5版の見本（芯材15 は木取りしない材料・重ね切りオン）で、組の1枚目の片を1つチェックした仕事 */
function checkedSample(): Job {
  let job = sampleGroupJob(true)
  const m = packJob(job, computeDimensions(job)).materials.find((x) => x.stack)!
  const layout = m.sheets[0]
  job = ok(
    setPieceCheck(
      job,
      { kind: 'computed', boardId: m.stack!.boardIds[0], stackWith: m.stack!.boardIds[1], mode: m.mode, layout },
      layout.placements[0].pieceId,
      true,
      NOW,
      'sheet-1',
    ),
  )
  return job
}

/**
 * 第2.4版の保存データの形（芯材 core 15）の、組の1枚目の片を1つチェックした仕事。
 * 第2.4版で計算した固定した1枚は芯材の有無で変わらないので、checkedSample を以前の形に戻して作る
 */
function legacyCheckedSample(): LegacyJob {
  return toLegacyJob(checkedSample())
}

/** 以前の形のフラッシュの厚み（core ＋ 中身の厚み×枚数）。移し替えで変わらないことを確かめる */
function legacyThicknesses(job: LegacyJob): number[] {
  return job.flushes.map((f) => (typeof f.core === 'number' ? f.core : 0) + flushThickness(f, job.boards))
}

/** 比べるための結果：寸法・木取り・固定した1枚の表示（「部材が変わっています」を含む）・まとめ */
function results(job: Job) {
  const dims = computeDimensions(job)
  const pack = packJob(job, dims)
  const views = frozenSheetViews(job, dims)
  const s = materialSummaries(job, pack, views)
  return { dims, pack, views, summary: [s.materials.map((m) => [m.boardId, m.sheetCount, pct(m.yieldRate)]), pct(s.totalYieldRate)] }
}

describe('保存データ第3版（kidori.jobs.v3）と v2 からの移し替え', () => {
  it('v2 のキーだけにある見本（組の1枚にチェック済み）を読むと 芯材15（木取りしない）が足され、結果は移す前と同じ', () => {
    const legacy = legacyCheckedSample()
    const v2 = JSON.stringify({ version: 2, jobs: [legacy] })
    const st = memoryStorage({ [JOBS_V2_KEY]: v2, [CURRENT_JOB_KEY]: legacy.id })
    const r = loadSaved(st, NOW)
    expect(r.status).toBe('ok')
    expect('message' in r).toBe(false)
    const job = dropAddedBuiltIns(r.data.jobs[0], legacy)
    const core = job.boards.at(-1)!
    expect([core.material, core.thickness, core.noCut]).toEqual(['芯材', 15, true])
    expect(job.boards.slice(0, -1)).toEqual(legacy.boards)
    const f = job.flushes[0]
    expect(f).toEqual({
      id: SAMPLE_FLUSH_ID,
      name: 'フラッシュ25',
      faces: [
        { boardId: core.id, count: 1 },
        { boardId: MELAMINE_1_ID, count: 2 },
        { boardId: LAUAN_4_ID, count: 2 },
      ],
      stack: true,
      form: 'flush',
      autoName: true,
    })
    expect(flushThickness(f, job.boards)).toBe(25)
    expect(job.parts).toEqual(legacy.parts)
    expect(job.frozenSheets).toEqual(legacy.frozenSheets)
    expect(job.stackSheets).toEqual(legacy.stackSheets)
    // 移す前（第2.4版）の結果は、同じ中身を第2.5版の形で持つ checkedSample の結果と同じ（芯材の材料の id だけが違う）
    const a = results(checkedSample())
    const b = results(job)
    expect(job.flushes.map((x) => flushThickness(x, job.boards))).toEqual(legacyThicknesses(legacy))
    expect(b.dims).toEqual(a.dims)
    expect(b.pack).toEqual(a.pack)
    expect(b.views).toEqual(a.views)
    expect(b.views[0].drift).toEqual([])
    expect(b.views[0].progress).toEqual(a.views[0].progress)
    expect(b.summary).toEqual(a.summary)
  })

  it('部材（桟）が使っている木取りする芯材15 は木取りしないにせず、芯材（木取りしない）15 を足す。桟の片は木取りされたまま', () => {
    const legacy = legacySampleFlushJob(true)
    const cutCore = { id: 'my-core', material: '芯材', thickness: 15, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
    const san = { ...legacy.parts[0], id: 'part-san', name: '桟', boardId: 'my-core', expr: { W: '300', H: '600', D: '15' }, quantity: 2 }
    const before = { ...legacy, boards: [...legacy.boards, cutCore], parts: [...legacy.parts, san] }
    const r = loadSaved(memoryStorage({ [JOBS_V2_KEY]: JSON.stringify({ version: 2, jobs: [before] }) }), NOW)
    expect(r.status).toBe('ok')
    const job = dropAddedBuiltIns(r.data.jobs[0], before)
    expect(job.boards.slice(0, -1)).toEqual(before.boards)
    const core = job.boards.at(-1)!
    expect([core.material, core.thickness, core.noCut]).toEqual(['芯材（木取りしない）', 15, true])
    expect(job.flushes[0].faces[0]).toEqual({ boardId: core.id, count: 1 })
    const pack = packJob(job, computeDimensions(job))
    const m = pack.materials.find((x) => x.boardId === 'my-core')!
    expect(m.sheets.flatMap((x) => x.placements).filter((x) => x.partId === 'part-san').length).toBe(2)
    expect(pct(pack.materials.find((x) => x.stack)!.yieldRate)).toBe(85.2)
  })

  it('保存すると v3 に version 3 で書かれ、v2 は1文字も変わらない。読み直しても同じ', () => {
    const v2 = JSON.stringify({ version: 2, jobs: [legacyCheckedSample()] })
    const st = memoryStorage({ [JOBS_V2_KEY]: v2 })
    const r = loadSaved(st, NOW)
    expect(saveSaved(st, r.data)).toEqual({ ok: true })
    expect(JOBS_KEY).toBe('kidori.jobs.v3')
    expect(JSON.parse(st.map.get(JOBS_KEY)!).version).toBe(3)
    expect(st.map.get(JOBS_V2_KEY)).toBe(v2)
    const again = loadSaved(st, NOW)
    expect(again.status).toBe('ok')
    expect(again.data.jobs).toEqual(r.data.jobs)
  })

  it('v3 があれば v2 は読まない', () => {
    const st = memoryStorage({
      [JOBS_KEY]: JSON.stringify({ version: 3, jobs: [] }),
      [JOBS_V2_KEY]: JSON.stringify({ version: 2, jobs: [legacyCheckedSample()] }),
    })
    const r = loadSaved(st, NOW)
    expect(r.data.jobs).toEqual([])
  })

  it('v3 のキーに version 2 の中身は読めない（error）', () => {
    const st = memoryStorage({ [JOBS_KEY]: JSON.stringify({ version: 2, jobs: [] }) })
    expect(loadSaved(st, NOW).status).toBe('error')
  })

  it('noCut・form・autoName を保存して読み直せる。おかしな値は外して直した数に数える', () => {
    const job = sampleJob(NOW)
    const st = memoryStorage()
    saveSaved(st, { jobs: [job], currentJobId: null })
    expect(loadSaved(st, NOW).data.jobs).toEqual([job])
    const raw = JSON.parse(JSON.stringify(job))
    raw.boards.at(-1).noCut = 'yes'
    raw.flushes[0].form = 'round'
    raw.flushes[0].autoName = 1
    const r = loadSaved(memoryStorage({ [JOBS_KEY]: JSON.stringify({ version: 3, jobs: [raw] }) }), NOW)
    expect(r.status).toBe('repaired')
    expect(r.data.jobs[0].boards.at(-1)!.noCut).toBeUndefined()
    expect(r.data.jobs[0].flushes[0].form).toBeUndefined()
    expect(r.data.jobs[0].flushes[0].autoName).toBeUndefined()
  })

  it('芯材が 0 以下のフラッシュは今までどおり外す（直した数）', () => {
    const job = JSON.parse(JSON.stringify(legacySampleFlushJob()))
    job.flushes[0].core = 0
    const r = loadSaved(memoryStorage({ [JOBS_V2_KEY]: JSON.stringify({ version: 2, jobs: [job] }) }), NOW)
    expect(r.status).toBe('repaired')
    expect(r.data.jobs[0].flushes).toEqual([])
  })
})

describe('見本（芯材15 は木取りしない材料）', () => {
  it('芯材15（木取りしない）を使い、厚み 25・組 3×6 で5枚 85.2%・ラワン4 の1枚 97.8%・全体 86.4%', () => {
    const job = sampleJob(NOW)
    const core = job.boards.find((b) => b.material === '芯材')!
    expect([core.thickness, core.noCut]).toEqual([15, true])
    const f = job.flushes[0]
    expect(f.faces.map((x) => [job.boards.find((b) => b.id === x.boardId)!.material, x.count])).toEqual([
      ['芯材', 1],
      ['メラミン', 2],
      ['ラワン', 2],
    ])
    expect(f).toMatchObject({ stack: true, form: 'flush', autoName: true })
    expect(flushThickness(f, job.boards)).toBe(25)
    const s = results(job).summary
    expect((s[0] as unknown[][]).map((x) => x.slice(1))).toEqual([
      [5, 85.2],
      [1, 97.8],
    ])
    expect(s[1]).toBe(86.4)
  })

  it('仕事のコピーで noCut・form・autoName が残る', () => {
    const job = sampleJob(NOW)
    const c = copyJob(job, [job.name], NOW)
    expect(c.boards.find((b) => b.material === '芯材')!.noCut).toBe(true)
    expect(c.flushes[0]).toMatchObject({ form: 'flush', autoName: true })
  })
})

// 第2.4版のコード（芯材 core を厚みに足していた版）で、移し替えの前後が同じことを確かめたときの値
const SHARE_V1_SUMMARY = [
  [
    ['stack:board-1+board-3', 5, 85.2],
    ['board-3', 1, 97.8],
  ],
  86.4,
]
const BACKUP_V1_SUMMARIES = [
  [
    [
      ['stack:board-1+board-3', 5, 85.2],
      ['board-3', 1, 97.8],
    ],
    86.4,
  ],
  [
    [
      ['stack:board-5+board-7', 5, 85.2],
      ['board-7', 1, 97.8],
    ],
    86.4,
  ],
]

describe('共有・バックアップのファイル（dataVersion 3）', () => {
  it('version 1（dataVersion 2）の共有・バックアップのファイルが同じ結果で取り込め、芯材15 に移る', () => {
    const r = readTransferFile(shareV1)
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.notice).toBeUndefined()
    const legacyShare = JSON.parse(shareV1).job as LegacyJob
    expect(legacyShare.flushes[0].core).toBe(15)
    expect(r.job.boards.find((b) => b.material === '芯材')!.noCut).toBe(true)
    expect('core' in r.job.flushes[0]).toBe(false)
    // 厚みが同じなら寸法・片・配置も同じ。見本の結果（第2.4版で読んだときと同じ値）
    expect(r.job.flushes.map((x) => flushThickness(x, r.job.boards))).toEqual(legacyThicknesses(legacyShare))
    expect(results(r.job).summary).toEqual(SHARE_V1_SUMMARY)

    const bk = readTransferFile(backupV1)
    if (!bk.ok || bk.kind !== 'backup') throw new Error('読めない')
    expect(bk.notice).toBeUndefined()
    const legacyJobs = JSON.parse(backupV1).jobs as LegacyJob[]
    expect(legacyJobs.every((j) => j.flushes.every((f) => f.core === 15))).toBe(true)
    bk.jobs.forEach((j, i) => {
      expect(j.flushes.every((f) => !('core' in f))).toBe(true)
      expect(j.flushes.map((x) => flushThickness(x, j.boards))).toEqual(legacyThicknesses(legacyJobs[i]))
      const res = results(j)
      expect(res.summary).toEqual(BACKUP_V1_SUMMARIES[i])
      // 固定した1枚は「部材が変わっています」にならない
      expect(res.views.every((v) => v.drift.length === 0)).toBe(true)
    })
  })

  it('書き出したファイルは dataVersion 3。dataVersion 4 は「新しい版」', () => {
    const job = sampleJob(NOW)
    const share = JSON.parse(buildShareFile(job, NOW))
    expect(share.dataVersion).toBe(3)
    const backup = JSON.parse(buildBackup({ jobs: [job] }, NOW))
    expect(backup.dataVersion).toBe(3)
    expect(readTransferFile(JSON.stringify({ ...share, dataVersion: 4 }))).toEqual({ ok: false, message: NEWER_VERSION })
  })

  it('dataVersion 3 の見本のファイル（fixtures）が読める：芯材15（木取りしない）・組 5枚 85.2%', () => {
    const r = readTransferFile(shareV3)
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.notice).toBeUndefined()
    expect(r.job.boards.find((b) => b.material === '芯材')!.noCut).toBe(true)
    expect(r.job.flushes[0]).toMatchObject({ name: 'フラッシュ25', form: 'flush', autoName: true, stack: true })
    const s = results(r.job).summary
    expect(s[1]).toBe(86.4)
  })
})

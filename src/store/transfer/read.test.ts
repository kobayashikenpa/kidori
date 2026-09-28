// S-25：ファイルの外側の形と読み取り（readTransferFile。architecture.md 16.2）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../../engine/dimensions'
import { bookshelfJob } from '../../engine/fixtures/bookshelf'
import { sampleFlushJob } from '../../engine/fixtures/flush'
import { packJob } from '../../engine/packing'
import type { Job } from '../../engine/types'
import { sampleFromTemplate } from '../sample'
import { sanitizeJobs } from '../storage'
import { defaultTemplate, templateOf } from '../template'
import { MAX_TRANSFER_SIZE, NEWER_VERSION, PARTIAL_NOTICE, READ_FAILED } from './envelope'
import { readTransferFile } from './read'
import shareV1 from './fixtures/share-v1.kidori.json?raw'
import backupV1 from './fixtures/backup-v1.json?raw'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const env = { app: 'kidori', version: 1, dataVersion: 2, exportedAt: NOW.toISOString() }
const shareText = (job: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ ...env, kind: 'share', job, ...extra })
const backupText = (jobs: unknown, template: unknown = defaultTemplate(), extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...env, kind: 'backup', jobs, template, ...extra })
const packOf = (job: Job) => {
  const r = packJob(job, computeDimensions(job))
  return [r.totalYieldRate, r.materials.map((m) => [m.sheetCount, m.yieldRate])]
}

describe('readTransferFile：共有のファイル', () => {
  it('見本を入れた共有のファイルの summary は 部材 5種類・9枚。寸法・木取りは元と同じ', () => {
    const job = sampleFromTemplate(defaultTemplate(), NOW)
    const r = readTransferFile(shareText(job))
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.summary).toEqual({ rows: 5, count: 9 })
    expect(r.notice).toBeUndefined()
    expect(r.job).toEqual(job)
    expect(packOf(r.job)).toEqual(packOf(job))
  })

  it('dataVersion: 1 の部材ごとの逃げがある仕事は今の読み込みと同じに移し替わる', () => {
    const legacy = JSON.parse(JSON.stringify(bookshelfJob()))
    delete legacy.settings.nige
    for (const p of legacy.parts) {
      delete p.memo
      delete p.checks
      p.clearance = {}
    }
    const shelf = legacy.parts.find((p: { name: string }) => p.name === '棚板')
    shelf.expr.W = '天地板.W'
    shelf.clearance = { W: 1 }
    const r = readTransferFile(shareText(legacy, { dataVersion: 1 }))
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.job).toEqual(sanitizeJobs([legacy], 1).jobs[0])
    expect(r.job.parts.find((p) => p.name === '棚板')!.expr.W).toBe('天地板.W - {n:nige-1}')
    expect(computeDimensions(r.job).parts.find((d) => d.name === '棚板')!.finished).toEqual({ W: 863, H: 18, D: 380 })
  })

  it('stackSheets の無い仕事は今の読み込みと同じに組の行ができる', () => {
    const raw = JSON.parse(JSON.stringify(sampleFlushJob(true)))
    delete raw.stackSheets
    const r = readTransferFile(shareText(raw))
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.job.stackSheets).toEqual(sanitizeJobs([raw]).jobs[0].stackSheets)
    expect(r.job.stackSheets).toHaveLength(1)
    expect(r.notice).toBeUndefined()
  })

  it('一部直したときは notice がつく', () => {
    const raw = JSON.parse(JSON.stringify(sampleFromTemplate(defaultTemplate(), NOW)))
    raw.parts.push({ bad: true })
    const r = readTransferFile(shareText(raw))
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.notice).toBe(PARTIAL_NOTICE)
    expect(r.summary.rows).toBe(5)
  })
})

describe('readTransferFile：バックアップのファイル', () => {
  it('仕事の一覧とひな形を読む', () => {
    const a = sampleFromTemplate(defaultTemplate(), NOW)
    const b = { ...bookshelfJob() }
    const t = templateOf(a)
    const r = readTransferFile(backupText([a, b], t))
    if (!r.ok || r.kind !== 'backup') throw new Error('読めない')
    expect(r.jobs).toEqual([a, b])
    expect(r.template).toEqual(t)
    expect(r.notice).toBeUndefined()
  })

  it('ひな形が読めなければ null（仕事は読む）。一部直ったひな形は直したもの', () => {
    const a = sampleFromTemplate(defaultTemplate(), NOW)
    const r1 = readTransferFile(backupText([a], 'x'))
    expect(r1.ok && r1.kind === 'backup' && r1.template).toBe(null)
    const r2 = readTransferFile(JSON.stringify({ ...env, kind: 'backup', jobs: [a] }))
    expect(r2.ok && r2.kind === 'backup' && r2.template).toBe(null)
    const r3 = readTransferFile(backupText([a], { settings: { kerf: -1 }, materials: 'x' }))
    if (!r3.ok || r3.kind !== 'backup') throw new Error('読めない')
    expect(r3.template!.settings.kerf).toBe(3)
    expect(r3.template!.materials).toEqual(defaultTemplate().materials)
  })

  it('読めない仕事が混ざっていれば外して notice。同じ id の仕事も外す', () => {
    const a = sampleFromTemplate(defaultTemplate(), NOW)
    const r = readTransferFile(backupText([a, 'x', a]))
    if (!r.ok || r.kind !== 'backup') throw new Error('読めない')
    expect(r.jobs).toHaveLength(1)
    expect(r.notice).toBe(PARTIAL_NOTICE)
  })
})

describe('readTransferFile：読めないファイル', () => {
  const job = sampleFromTemplate(defaultTemplate(), NOW)
  const good = shareText(job)
  const cases: [string, string][] = [
    ['空の文字列', ''],
    ['空白だけ', '  \n'],
    ['JSON でない', 'こんにちは'],
    ['途中で切れた JSON', good.slice(0, good.length - 10)],
    ['null', 'null'],
    ['配列', '[1,2]'],
    ['app が違う', JSON.stringify({ ...JSON.parse(good), app: 'other' })],
    ['app が無い（kidori 以外の JSON）', JSON.stringify({ name: 'x', version: 1 })],
    ['kind が知らない値', JSON.stringify({ ...JSON.parse(good), kind: 'other' })],
    ['version が無い', JSON.stringify({ ...JSON.parse(good), version: undefined })],
    ['version が 0', JSON.stringify({ ...JSON.parse(good), version: 0 })],
    ['dataVersion が無い', JSON.stringify({ ...JSON.parse(good), dataVersion: undefined })],
    ['job の形が違う（配列）', shareText([job])],
    ['job が文字列', shareText('x')],
    ['job が無い', JSON.stringify({ ...env, kind: 'share' })],
    ['共有の仕事が読めない', shareText({ id: 1 })],
    ['jobs の形が違う', backupText({ a: job })],
    ['仕事が1つも読めないバックアップ', backupText(['x', { id: '' }])],
    ['仕事が0件のバックアップ', backupText([])],
    ['画像のファイル（バイナリ）', '\u0089PNG\r\n\u001a\n\u0000\u0000'],
  ]
  for (const [name, text] of cases) {
    it(`${name} → 読み込めませんでした`, () => {
      expect(readTransferFile(text)).toEqual({ ok: false, message: READ_FAILED })
    })
  }

  it('version: 99・dataVersion: 99 は「新しい版」の文言', () => {
    expect(readTransferFile(JSON.stringify({ ...JSON.parse(good), version: 99 }))).toEqual({ ok: false, message: NEWER_VERSION })
    expect(readTransferFile(JSON.stringify({ ...JSON.parse(good), version: 2, kind: 'other' }))).toEqual({ ok: false, message: NEWER_VERSION })
    expect(readTransferFile(JSON.stringify({ ...JSON.parse(good), dataVersion: 99 }))).toEqual({ ok: false, message: NEWER_VERSION })
    expect(NEWER_VERSION).toContain('新しい版')
  })

  it('20MB を超える文字列は読まない', () => {
    const big = good + ' '.repeat(MAX_TRANSFER_SIZE)
    expect(readTransferFile(big)).toEqual({ ok: false, message: READ_FAILED })
  })

  it('文字列でないものを渡しても例外を投げない', () => {
    expect(readTransferFile(undefined as unknown as string)).toEqual({ ok: false, message: READ_FAILED })
    expect(readTransferFile(123 as unknown as string)).toEqual({ ok: false, message: READ_FAILED })
  })
})

describe('fixtures（version: 1 のファイル。あとの版でも読めることを確かめ続ける）', () => {
  it('共有のファイル：本棚 W900・部材 5種類・9枚。組 5枚 85.2% など見本と同じ木取り', () => {
    const r = readTransferFile(shareV1)
    if (!r.ok || r.kind !== 'share') throw new Error('読めない')
    expect(r.job.name).toBe('本棚 W900')
    expect(r.summary).toEqual({ rows: 5, count: 9 })
    expect(r.notice).toBeUndefined()
    expect(packOf(r.job)).toEqual(packOf(sampleFromTemplate(defaultTemplate(), NOW)))
    const m = packJob(r.job, computeDimensions(r.job)).materials.find((x) => x.stack)!
    expect([m.sheetCount, Math.round(m.yieldRate * 1000) / 10]).toEqual([5, 85.2])
  })

  it('バックアップのファイル：2件（本棚 W900・食器棚）、固定した1枚とひな形あり。stackSheets の無い仕事も組の行ができる', () => {
    const r = readTransferFile(backupV1)
    if (!r.ok || r.kind !== 'backup') throw new Error('読めない')
    expect(r.jobs.map((j) => j.name)).toEqual(['本棚 W900', '食器棚'])
    expect(r.notice).toBeUndefined()
    expect(r.jobs[0].frozenSheets).toHaveLength(1)
    expect(r.jobs[0].frozenSheets[0].stackWith).toBeDefined()
    expect(r.jobs[0].frozenSheets[0].checked).toHaveLength(1)
    expect(r.jobs[1].stackSheets).toHaveLength(1)
    expect(r.template).not.toBeNull()
    expect(r.template!.flushes.map((f) => f.name)).toEqual(['フラッシュ25'])
  })
})

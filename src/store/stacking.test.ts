// S-32（第2.6版。architecture.md 18.7・18.8）：仕事ごとの「重ね切り」の保存と、以前のデータの移し替え
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../engine/fixtures/flush'
import { BETA20, groupPart, stackJob } from '../engine/fixtures/stackNew'
import { packJob } from '../engine/packing'
import { stackKey } from '../engine/packing/stack'
import type { Job } from '../engine/types'
import { createJob, setStacking } from './jobs'
import { sampleJob } from './sample'
import { JOBS_KEY, loadSaved, sanitizeJobs, saveSaved, type KeyValueStorage } from './storage'

const NOW = new Date('2026-09-30T00:00:00.000Z')
const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)

/** 第2.5.1版までのデータ（stacking が無い）。JSON の写し */
function legacy(job: Job, edit?: (j: Record<string, any>) => void): unknown {
  const j = JSON.parse(JSON.stringify(job)) as Record<string, any>
  delete j.stacking
  edit?.(j)
  return j
}
const load = (raw: unknown) => sanitizeJobs([raw])
function memory(): KeyValueStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

describe('以前のデータの移し替え（stacking が無い仕事だけ1回）', () => {
  it('第2.5.1版の見本（フラッシュ25 重ね切りオン）→ on・結果は同じ（組 5枚・ラワン4 1枚）。直した数に数えない', () => {
    const r = load(legacy(sampleGroupJob(true)))
    expect(r.fixes).toBe(0)
    expect(r.jobs[0].stacking).toBe('on')
    const p = packJob(r.jobs[0], computeDimensions(r.jobs[0]))
    expect(p.materials.map((m) => [m.boardId, m.sheetCount])).toEqual([
      [KEY, 5],
      [LAUAN_4_ID, 1],
    ])
  })

  it('「重ねて切る」を外したフラッシュ25 を部材が使っている仕事 → off', () => {
    const r = load(legacy(sampleGroupJob(false)))
    expect(r.fixes).toBe(0)
    expect(r.jobs[0].stacking).toBe('off')
    expect(packJob(r.jobs[0], computeDimensions(r.jobs[0])).materials.map((m) => m.boardId)).toEqual([MELAMINE_1_ID, LAUAN_4_ID])
  })

  it('外していても部材が使っていなければ（枚数 0）on', () => {
    const r = load(legacy(sampleGroupJob(false), (j) => j.parts.forEach((p: { flushId?: string; quantity: number }) => p.flushId && (p.quantity = 0))))
    expect(r.jobs[0].stacking).toBe('on')
  })

  it('ベタ20 だけの仕事（以前の決まりで重ねられない）→ on', () => {
    expect(load(legacy(stackJob([groupPart('側板', BETA20, 1800, 800, 2)]))).jobs[0].stacking).toBe('on')
  })

  it('stacking があればそのまま（一度 on にして保存して読み直すと on のまま。off も）', () => {
    const base = legacy(sampleGroupJob(false)) as Job
    expect(load({ ...base, stacking: 'on' }).jobs[0].stacking).toBe('on')
    expect(load({ ...sampleGroupJob(true), stacking: 'off' }).jobs[0].stacking).toBe('off')
    const s = memory()
    const job = load(base).jobs[0]
    const on = setStacking(job, 'on')
    if (!on.ok) throw new Error(on.message)
    expect(saveSaved(s, { jobs: [on.job], currentJobId: on.job.id })).toEqual({ ok: true })
    const r = loadSaved(s, NOW)
    expect(r.status === 'ok' && r.data.jobs[0].stacking).toBe('on')
  })

  it('読めない値（yes）は直した数に数えて、以前のデータと同じく決める', () => {
    const r = load(legacy(sampleGroupJob(false), (j) => (j.stacking = 'yes')))
    expect(r.fixes).toBe(1)
    expect(r.jobs[0].stacking).toBe('off')
  })

  it('最初の材料の自動の追加がある読み込み（loadSaved）でも同じ結果', () => {
    const s = memory()
    s.setItem(JOBS_KEY, JSON.stringify({ version: 3, jobs: [legacy(sampleGroupJob(false)), legacy({ ...sampleGroupJob(true), id: 'job-2' })] }))
    const r = loadSaved(s, NOW)
    if (r.status !== 'ok') throw new Error(r.status)
    expect(r.data.jobs.map((j) => j.stacking)).toEqual(['off', 'on'])
    expect(r.data.jobs[1].boards.length).toBeGreaterThan(sampleGroupJob(true).boards.length)
  })
})

describe('端材から取った1枚の写し（layout.sheet.offcut）の検査', () => {
  function withOffcut(offcut: unknown): unknown {
    const job = stackJob([groupPart('側板', BETA20, 1800, 800, 1)])
    const layout = packJob(job, computeDimensions(job)).materials[0].sheets[0]
    const frozen = {
      id: 'f1', boardId: layout.placements[0] ? job.boards[0].id : '', material: 'メラミン', thickness: 1, grain: 'long', mode: 'vertical',
      kerf: 3, trim: 5, checked: [layout.placements[0].pieceId], frozenAt: NOW.toISOString(), completedAt: NOW.toISOString(),
      layout: { ...layout, sheet: { stockId: 'offcut:x:0', sizeKind: 'custom', grain: 'long', offcut } },
    }
    return { ...job, frozenSheets: [frozen] }
  }

  it('source が 1 以上の整数なら残す', () => {
    const r = load(withOffcut({ source: 2 }))
    expect(r.fixes).toBe(0)
    expect(r.jobs[0].frozenSheets[0].layout.sheet?.offcut).toEqual({ source: 2 })
  })

  it('source が 0・小数・無いなら offcut だけ外す（直した数 1）', () => {
    for (const bad of [{ source: 0 }, { source: 1.5 }, {}, 'x']) {
      const r = load(withOffcut(bad))
      expect(r.fixes).toBe(1)
      expect(r.jobs[0].frozenSheets[0].layout.sheet).toEqual({ stockId: 'offcut:x:0', sizeKind: 'custom', grain: 'long' })
    }
  })
})

describe('操作', () => {
  it('createJob・見本は on。見本のフラッシュ25 に stack は無い', () => {
    expect(createJob('x', NOW).stacking).toBe('on')
    const s = sampleJob(NOW)
    expect([s.stacking, s.flushes[0].stack]).toEqual(['on', undefined])
  })

  it('setStacking で切り替える。同じ値なら同じ仕事、読めない値は断る', () => {
    const job = sampleGroupJob(true)
    const off = setStacking(job, 'off')
    expect(off.ok && off.job.stacking).toBe('off')
    const same = setStacking(job, 'on')
    expect(same.ok && same.job).toBe(job)
    expect(setStacking(job, 'x' as Job['stacking']).ok).toBe(false)
  })
})

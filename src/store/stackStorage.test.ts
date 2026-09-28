// S-22 → S-23：重ね切りの組の設定（stackSheets）の読み込みと、第2.2版までのデータの移し替え（architecture.md 15.6・15.9）。
// 組は 3×6／4×8 だけ。サイズがそろわない・手持ち・自由入力の組は、読み込むときに重ね切りを外して知らせる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { LAUAN_25_ID, LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../engine/fixtures/flush'
import { stockRows } from '../engine/fixtures/stock'
import { packJob } from '../engine/packing'
import { stackKey } from '../engine/packing/stack'
import type { Job } from '../engine/types'
import { loadSaved, sanitizeJobs, saveSaved, type KeyValueStorage } from './storage'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const S36 = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const
const rows = (job: Job) => packJob(job, computeDimensions(job)).materials.map((m) => [m.boardId, m.sheetCount, m.sheets[0]?.boardWidth])

/** 第2.2版までのデータ（stackSheets が無い）。JSON の写し */
function legacy(edit?: (j: Record<string, unknown> & Job) => void): unknown {
  const j = JSON.parse(JSON.stringify(sampleFlushJob(true))) as Record<string, unknown> & Job
  delete (j as Partial<Job>).stackSheets
  edit?.(j)
  return j
}
function load(raw: unknown) {
  const r = sanitizeJobs([raw])
  return { job: r.jobs[0], fixes: r.fixes }
}
const lauan = (j: Job) => j.boards.find((b) => b.id === LAUAN_4_ID)!
const melamine = (j: Job) => j.boards.find((b) => b.id === MELAMINE_1_ID)!

const NOTICE = 'サイズがそろっていないので、重ね切りを外しました：フラッシュ25'
const stackOf = (j: Job) => j.flushes[0].stack

describe('stackSheets の無い仕事の移し替え（1回だけ）', () => {
  it('重ね切りの見本（2つとも 3×6）を読むと組の行が 3×6 で1つでき、組 5枚のまま（直した数に数えない・知らせなし）', () => {
    const r = sanitizeJobs([legacy()])
    const job = r.jobs[0]
    expect(r.fixes).toBe(0)
    expect(r.unstacked).toEqual([])
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(stackOf(job)).toBe(true)
    expect(rows(job)).toEqual([
      [KEY, 5, 910],
      [LAUAN_4_ID, 1, 910],
    ])
  })

  it('2つとも 4×8 なら組の行は 4×8。3×6 と自由入力 910×1820（長手）なら 3×6 で重ねる', () => {
    expect(load(legacy((j) => j.boards.forEach((b) => Object.assign(b, S48)))).job.stackSheets).toEqual([
      { boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48 },
    ])
    const mixed = load(legacy((j) => Object.assign(lauan(j), { ...S36, sizeKind: 'custom' }))).job
    expect(mixed.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(stackOf(mixed)).toBe(true)
  })

  it('ラワン 4 が 4×8 の以前のデータ（サイズがそろわず重ねていなかった）→ 重ね切りを外し、組の行は作らない。知らせる', () => {
    const r = sanitizeJobs([legacy((j) => Object.assign(lauan(j), S48))])
    const job = r.jobs[0]
    expect(r.fixes).toBe(0)
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(stackOf(job)).toBeUndefined()
    expect(job.stackSheets).toEqual([])
    // 以前と同じく、メラミン 1・ラワン 4 それぞれでふつうに木取り
    expect(rows(job).map((x) => x[0])).toEqual([MELAMINE_1_ID, LAUAN_4_ID])
  })

  it('木目だけ違う（自由入力 910×1820 の妻手）ときもそろっていない', () => {
    const r = sanitizeJobs([legacy((j) => Object.assign(lauan(j), { ...S36, sizeKind: 'custom', grain: 'short' }))])
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(stackOf(r.jobs[0])).toBeUndefined()
  })

  it('2つとも自由入力 910×1820（共通の大きさが自由入力）→ 重ね切りを外す', () => {
    const r = sanitizeJobs([legacy((j) => j.boards.forEach((b) => Object.assign(b, { ...S36, sizeKind: 'custom' })))])
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(stackOf(r.jobs[0])).toBeUndefined()
    expect(r.jobs[0].stackSheets).toEqual([])
  })

  it('メラミン 1・ラワン 4 ともに手持ち 3×6 ×6（手持ちで重ねていた）→ 重ね切りを外す。材料の手持ちはそのまま', () => {
    const r = sanitizeJobs([
      legacy((j) => {
        Object.assign(melamine(j), { stockOn: true, stock: stockRows([['3×6', 6]]) })
        Object.assign(lauan(j), { stockOn: true, stock: stockRows([['3×6', 6]]) })
      }),
    ])
    const job = r.jobs[0]
    expect(r.fixes).toBe(0)
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(stackOf(job)).toBeUndefined()
    expect(job.stackSheets).toEqual([])
    expect(melamine(job).stock).toEqual(stockRows([['3×6', 6]]))
    expect(lauan(job).stock).toEqual(stockRows([['3×6', 6]]))
  })

  it('片方だけ手持ち（メラミン 1 が手持ち 3×6 ×10）でも重ね切りを外す。手持ちの行があるだけ（オフ）ならそのまま重ねる', () => {
    const on = sanitizeJobs([legacy((j) => Object.assign(melamine(j), { stockOn: true, stock: stockRows([['3×6', 10]]) }))])
    expect(on.unstacked).toEqual(['フラッシュ25'])
    const off = sanitizeJobs([legacy((j) => Object.assign(melamine(j), { stock: stockRows([['3×6', 10]]) }))])
    expect(off.unstacked).toEqual([])
    expect(off.jobs[0].stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
  })

  it('固定した組の1枚は切った記録として残る（重ね切りを外しても）', () => {
    const base = sampleFlushJob(true)
    const g = packJob(base, computeDimensions(base)).materials.find((m) => m.boardId === KEY)!
    const frozen = {
      id: 'f1',
      boardId: MELAMINE_1_ID,
      material: 'メラミン',
      thickness: 1,
      grain: 'long',
      mode: g.mode,
      kerf: 3,
      trim: 5,
      layout: g.sheets[0],
      checked: [g.sheets[0].placements[0].pieceId],
      frozenAt: '2026-09-27T00:00:00.000Z',
      stackWith: { boardId: LAUAN_4_ID, material: 'ラワン', thickness: 4 },
    }
    const r = sanitizeJobs([legacy((j) => {
      Object.assign(lauan(j), S48)
      j.frozenSheets = [frozen as Job['frozenSheets'][number]]
    })])
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(r.jobs[0].frozenSheets).toEqual([frozen])
  })

  it('重ね切りがオフの組・重ね切りの無い仕事は行を作らない（知らせなし）', () => {
    const r = sanitizeJobs([legacy((j) => delete (j.flushes[0] as { stack?: true }).stack)])
    expect(r.jobs[0].stackSheets).toEqual([])
    expect(r.unstacked).toEqual([])
  })

  it('stackSheets: [] の仕事は移し替えない（ラワン 4 が 4×8 でも組 4×8 で重ねる）', () => {
    const raw = legacy((j) => {
      j.stackSheets = []
      Object.assign(lauan(j), S48)
    })
    const r = sanitizeJobs([raw])
    expect(r.fixes).toBe(0)
    expect(r.unstacked).toEqual([])
    expect(r.jobs[0].stackSheets).toEqual([])
    expect(stackOf(r.jobs[0])).toBe(true)
  })

  it('loadSaved：外したときは知らせ（status ok）。寸法の変わった知らせとは「。」でつなぐ', () => {
    const map = new Map<string, string>()
    const s: KeyValueStorage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
    map.set('kidori.jobs.v2', JSON.stringify({ version: 2, jobs: [legacy((j) => Object.assign(lauan(j), S48))] }))
    const r = loadSaved(s, new Date('2026-09-28T00:00:00Z'))
    expect(r.status).toBe('ok')
    expect(r.status === 'ok' && r.message).toBe(NOTICE)
  })

  it('2つの仕事で外すと、フラッシュの名前を重ねずに並べる', () => {
    const a = legacy((j) => Object.assign(lauan(j), S48)) as Job
    const b = legacy((j) => {
      Object.assign(lauan(j), S48)
      j.id = 'job-2'
      j.flushes.push({ ...j.flushes[0], id: 'flush-2', name: 'フラッシュ22' })
    }) as Job
    expect(sanitizeJobs([a, b]).unstacked).toEqual(['フラッシュ25', 'フラッシュ22'])
  })
})

describe('stackSheets のある仕事の組の行が自由入力・手持ち（S-23）', () => {
  const withRows = (stackSheets: unknown, edit?: (j: Job) => void) =>
    legacy((j) => {
      ;(j as Record<string, unknown>).stackSheets = stackSheets
      edit?.(j)
    })

  it('組の行が手持ち（stockOn）→ 手持ちを外して 3×6／4×8 の行は残し、フラッシュ25 の重ね切りを外して知らせる', () => {
    const r = sanitizeJobs([withRows([{ boardIds: [LAUAN_4_ID, MELAMINE_1_ID], ...S48, stockOn: true, stock: [{ id: 'x', ...S36, count: 2 }] }])])
    expect(r.fixes).toBe(0)
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(r.jobs[0].stackSheets).toEqual([{ boardIds: [LAUAN_4_ID, MELAMINE_1_ID], ...S48 }])
    expect(stackOf(r.jobs[0])).toBeUndefined()
  })

  it('組の行が自由入力の大きさ → 行を消し、重ね切りを外して知らせる', () => {
    const r = sanitizeJobs([withRows([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 910, length: 1820, grain: 'long' }])])
    expect(r.unstacked).toEqual(['フラッシュ25'])
    expect(r.jobs[0].stackSheets).toEqual([])
    expect(stackOf(r.jobs[0])).toBeUndefined()
  })

  it('組の行に手持ちの行があるだけ（オフ）→ 黙って手持ちを外し、重ね切りは残す', () => {
    const r = sanitizeJobs([withRows([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36, stock: [{ id: 'x', ...S36, count: 2 }] }])])
    expect(r.fixes).toBe(0)
    expect(r.unstacked).toEqual([])
    expect(r.jobs[0].stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(stackOf(r.jobs[0])).toBe(true)
  })

  it('重ね切りがオフの組の行が手持ち・自由入力なら、黙って手持ち・自由入力を外す（知らせなし）', () => {
    const r = sanitizeJobs([
      withRows(
        [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36, stockOn: true, stock: [{ id: 'x', ...S36, count: 2 }] }],
        (j) => delete (j.flushes[0] as { stack?: true }).stack,
      ),
    ])
    expect(r.unstacked).toEqual([])
    expect(r.jobs[0].stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
  })
})

describe('stackSheets の検査・修復', () => {
  const withRows = (stackSheets: unknown) => legacy((j) => ((j as Record<string, unknown>).stackSheets = stackSheets))

  it('正しい行はそのまま（直した数 0）。並びが逆でもよい', () => {
    const good = [{ boardIds: [LAUAN_4_ID, MELAMINE_1_ID], ...S48 }]
    const { job, fixes } = load(withRows(good))
    expect(fixes).toBe(0)
    expect(job.stackSheets).toEqual(good)
  })

  it('無い材料を指す行・同じ組の2つ目の行・同じ材料2つの行は外れて直した数に数える', () => {
    const { job, fixes } = load(
      withRows([
        { boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 },
        { boardIds: [MELAMINE_1_ID, 'board-none'], ...S36 },
        { boardIds: [LAUAN_4_ID, MELAMINE_1_ID], ...S48 },
        { boardIds: [LAUAN_25_ID, LAUAN_25_ID], ...S36 },
        { boardIds: [MELAMINE_1_ID], ...S36 },
        'x',
      ]),
    )
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(fixes).toBe(5)
  })

  it('枚数 0 の手持ちの行は外れて直した数に数え、行が0になれば stockOn も外す（組は手持ちを使わないので、手持ちが残らない）', () => {
    const r = sanitizeJobs([withRows([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36, stockOn: true, stock: [{ id: 'x', ...S36, count: 0 }] }])])
    expect(r.jobs[0].stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(r.fixes).toBe(2)
    expect(r.unstacked).toEqual([])
  })

  it('大きさの読めない行は外す（直した数）', () => {
    const { job, fixes } = load(
      withRows([
        { boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 },
        { boardIds: [MELAMINE_1_ID, LAUAN_25_ID], sizeKind: 'custom', width: -1, length: 910, grain: 'long' },
      ]),
    )
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(fixes).toBe(1)
  })

  it('配列でなければ [] にして直した数に数える（移し替えない）', () => {
    const { job, fixes } = load(withRows('broken'))
    expect(job.stackSheets).toEqual([])
    expect(fixes).toBe(1)
  })

  it('保存して読み込むと組の設定が残る', () => {
    const map = new Map<string, string>()
    const s: KeyValueStorage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
    const job = sampleFlushJob(true)
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48 }]
    expect(saveSaved(s, { jobs: [job], currentJobId: job.id })).toEqual({ ok: true })
    const r = loadSaved(s, new Date('2026-09-28T00:00:00Z'))
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual(job)
  })
})

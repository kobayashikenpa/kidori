// S-22：重ね切りの組の設定（stackSheets）の読み込みと、第2.2版までのデータの移し替え（architecture.md 15.6）
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

describe('stackSheets の無い仕事の移し替え（1回だけ）', () => {
  it('重ね切りの見本（2つとも 3×6）を読むと組の行が 3×6 で1つでき、組 5枚のまま（直した数に数えない）', () => {
    const { job, fixes } = load(legacy())
    expect(fixes).toBe(0)
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(rows(job)).toEqual([
      [KEY, 5, 910],
      [LAUAN_4_ID, 1, 910],
    ])
  })

  it('ラワン 4 が 4×8 の以前のデータ（今までは重ねていない）→ 組の行は 3×6（メラミン 1 のサイズ）で、組 5枚・背板の1枚は 4×8', () => {
    const { job } = load(legacy((j) => Object.assign(lauan(j), S48)))
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(rows(job)).toEqual([
      [KEY, 5, 910],
      [LAUAN_4_ID, 1, 1220],
    ])
  })

  it('メラミン 1・ラワン 4 ともに手持ち 3×6 ×6 → 組の行が自由入力（手持ち 3×6 ×6）。材料の手持ちはそのまま（未決事項 43）', () => {
    const { job, fixes } = load(
      legacy((j) => {
        Object.assign(melamine(j), { stockOn: true, stock: stockRows([['3×6', 6]]) })
        Object.assign(lauan(j), { stockOn: true, stock: stockRows([['3×6', 6]]) })
      }),
    )
    expect(fixes).toBe(0)
    expect(job.stackSheets).toEqual([
      { boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36, stockOn: true, stock: [{ id: 's1', ...S36, count: 6 }] },
    ])
    expect(melamine(job).stock).toEqual(stockRows([['3×6', 6]]))
    expect(lauan(job).stock).toEqual(stockRows([['3×6', 6]]))
  })

  it('手持ちのそろう行は枚数の少ないほう。そろう行が無ければ組は手持ちなし（a のサイズ）', () => {
    const three = load(
      legacy((j) => {
        Object.assign(melamine(j), { stockOn: true, stock: stockRows([['3×6', 3], ['4×8', 2]]) })
        Object.assign(lauan(j), { stockOn: true, stock: stockRows([['3×6', 6]]) })
      }),
    ).job
    expect(three.stackSheets[0]).toEqual({ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36, stockOn: true, stock: [{ id: 's1', ...S36, count: 3 }] })
    const none = load(
      legacy((j) => {
        Object.assign(melamine(j), { stockOn: true, stock: stockRows([['4×8', 3]]) })
      }),
    ).job
    expect(none.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
  })

  it('重ね切りがオフの組・重ね切りの無い仕事は行を作らない', () => {
    expect(load(legacy((j) => delete (j.flushes[0] as { stack?: true }).stack)).job.stackSheets).toEqual([])
  })

  it('stackSheets: [] の仕事は移し替えない', () => {
    const raw = legacy((j) => {
      j.stackSheets = []
      Object.assign(lauan(j), S48)
    })
    const { job, fixes } = load(raw)
    expect(fixes).toBe(0)
    expect(job.stackSheets).toEqual([])
  })
})

describe('stackSheets の検査・修復', () => {
  const withRows = (stackSheets: unknown) => legacy((j) => ((j as Record<string, unknown>).stackSheets = stackSheets))

  it('正しい行はそのまま（直した数 0）。並びが逆でもよい', () => {
    const good = [{ boardIds: [LAUAN_4_ID, MELAMINE_1_ID], ...S48, stockOn: true, stock: [{ id: 'x', ...S36, count: 2 }] }]
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

  it('枚数 0 の手持ちの行は外れて直した数に数え、行が0になれば stockOn も外す', () => {
    const { job, fixes } = load(withRows([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36, stockOn: true, stock: [{ id: 'x', ...S36, count: 0 }] }]))
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S36 }])
    expect(fixes).toBe(2)
  })

  it('大きさの読めない行は外す。自由入力の短辺＞長辺は入れ替える', () => {
    const { job, fixes } = load(
      withRows([
        { boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 1820, length: 910, grain: 'short' },
        { boardIds: [MELAMINE_1_ID, LAUAN_25_ID], sizeKind: 'custom', width: -1, length: 910, grain: 'long' },
      ]),
    )
    expect(job.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], sizeKind: 'custom', width: 910, length: 1820, grain: 'short' }])
    expect(fixes).toBe(2)
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
    job.stackSheets = [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48, stockOn: true, stock: [{ id: 'st', ...S36, count: 3 }] }]
    expect(saveSaved(s, { jobs: [job], currentJobId: job.id })).toEqual({ ok: true })
    const r = loadSaved(s, new Date('2026-09-28T00:00:00Z'))
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual(job)
  })
})

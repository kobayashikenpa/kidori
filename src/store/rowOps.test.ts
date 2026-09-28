// S-21：まとめの行（材料の行・重ね切りの組の行）の操作と、コピー・削除・見本（第2.3版。architecture.md 15.6）
import { describe, expect, it } from 'vitest'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../engine/fixtures/flush'
import type { Job } from '../engine/types'
import {
  addRowStock,
  copyJob,
  createJob,
  removeBoards,
  removeRowStock,
  setRowSize,
  setRowStockMode,
  updateRowStock,
  type OpResult,
} from './jobs'
import { sampleFromTemplate } from './sample'
import { defaultTemplate, sameTemplate, templateOf } from './template'

const NOW = new Date('2026-09-28T09:00:00.000Z')
const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const
const S36 = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
const S48 = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const
const must = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const board = (job: Job, id: string) => job.boards.find((b) => b.id === id)!

describe('見本の組の設定', () => {
  it('見本（ひな形から）の組（メラミン 1＋ラワン 4）の設定は 3×6。ラワン 4 の行を 4×8 にしてもメラミン 1 は 3×6 のまま', () => {
    const sample = sampleFromTemplate(defaultTemplate(), NOW)
    const [f] = sample.flushes.filter((x) => x.name === 'フラッシュ25')
    const ids = f.faces.map((x) => x.boardId)
    expect(sample.stackSheets).toEqual([{ boardIds: ids, ...S36 }])
    const lauan = ids[1]
    const j = must(setRowSize(sample, lauan, S48))
    expect(board(j, lauan)).toMatchObject(S48)
    expect(board(j, ids[0])).toMatchObject(S36)
    expect(j.stackSheets[0]).toMatchObject(S36)
  })

  it('新しい仕事の組の設定は空（ひな形に入れない）', () => {
    expect(createJob('x', defaultTemplate(), NOW).stackSheets).toEqual([])
  })
})

describe('setRowSize・setRowStockMode（行のサイズと自由入力）', () => {
  it('組の行を 4×8 にすると stackSheets の組だけ 4×8 で、メラミン 1・ラワン 4 は変わらない', () => {
    const base = sampleFlushJob(true)
    const j = must(setRowSize(base, PAIR, S48))
    expect(j.stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48 }])
    expect(j.boards).toEqual(base.boards)
  })

  it('手持ちの行がある材料で 3×6 を選ぶと stockOn が外れて行は残り、自由入力を選ぶと同じ行で戻る', () => {
    const on = must(addRowStock(must(setRowStockMode(sampleFlushJob(true), LAUAN_4_ID, true, 'st-1')), LAUAN_4_ID, { ...S48, count: 2 }, 'st-2'))
    const rows = board(on, LAUAN_4_ID).stock
    expect(board(on, LAUAN_4_ID).stockOn).toBe(true)
    const off = must(setRowSize(on, LAUAN_4_ID, S36))
    expect(board(off, LAUAN_4_ID).stockOn).toBeUndefined()
    expect(board(off, LAUAN_4_ID).stock).toEqual(rows)
    expect(board(off, LAUAN_4_ID)).toMatchObject(S36)
    const again = must(setRowStockMode(off, LAUAN_4_ID, true, 'st-9'))
    expect(board(again, LAUAN_4_ID).stockOn).toBe(true)
    expect(board(again, LAUAN_4_ID).stock).toEqual(rows)
  })

  it('組の行で自由入力を選ぶと 4×8 ×1 の行が入る（組の設定が無いとき）', () => {
    const job = sampleFlushJob(true)
    job.stackSheets = []
    const j = must(setRowStockMode(job, PAIR, true, 'st-1'))
    expect(j.stackSheets).toEqual([
      { boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48, stockOn: true, stock: [{ id: 'st-1', ...S48, count: 1 }] },
    ])
    // 組の設定が 3×6 なら 3×6 ×1
    const k = must(setRowStockMode(sampleFlushJob(true), PAIR, true, 'st-1'))
    expect(k.stackSheets[0].stock).toEqual([{ id: 'st-1', ...S36, count: 1 }])
  })

  it('組の行の手持ちを足す・変える・消す。最後の1行を消すと stockOn が外れる。材料の行は変わらない', () => {
    const base = sampleFlushJob(true)
    const on = must(setRowStockMode(base, PAIR, true, 'st-1'))
    const two = must(addRowStock(on, [LAUAN_4_ID, MELAMINE_1_ID], { ...S48, count: 3 }, 'st-2'))
    expect(two.stackSheets[0].stock!.map((s) => [s.id, s.sizeKind, s.count])).toEqual([
      ['st-1', 'saburoku', 1],
      ['st-2', 'shihachi', 3],
    ])
    const upd = must(updateRowStock(two, PAIR, 'st-1', { count: 5 }))
    expect(upd.stackSheets[0].stock![0].count).toBe(5)
    expect(updateRowStock(two, PAIR, 'st-1', { count: 0 })).toEqual({ ok: false, message: '枚数は1以上の整数にしてください' })
    expect(updateRowStock(two, PAIR, 'nai', { count: 1 }).ok).toBe(false)
    const one = must(removeRowStock(upd, PAIR, 'st-1'))
    expect(one.stackSheets[0].stockOn).toBe(true)
    const none = must(removeRowStock(one, PAIR, 'st-2'))
    expect(none.stackSheets[0].stockOn).toBeUndefined()
    expect(none.stackSheets[0].stock).toBeUndefined()
    expect(none.boards).toEqual(base.boards)
  })

  it('無い材料・同じ材料2つの組は断る。元の仕事は書き換えない', () => {
    const base = sampleFlushJob(true)
    const snap = JSON.stringify(base)
    expect(setRowSize(base, 'nai', S48)).toEqual({ ok: false, message: '材料が見つかりません' })
    expect(setRowStockMode(base, [MELAMINE_1_ID, 'nai'], true).ok).toBe(false)
    expect(addRowStock(base, [LAUAN_4_ID, LAUAN_4_ID], { ...S36, count: 1 }).ok).toBe(false)
    must(setRowStockMode(base, PAIR, true))
    must(setRowSize(base, PAIR, S48))
    expect(JSON.stringify(base)).toBe(snap)
  })

  it('自由入力の大きさ（以前の自由入力）も選べ、短辺＞長辺は入れ替える。0 以下は断る', () => {
    const j = must(setRowSize(sampleFlushJob(true), PAIR, { sizeKind: 'custom', width: 1820, length: 910, grain: 'short' }))
    expect(j.stackSheets[0]).toMatchObject({ sizeKind: 'custom', width: 910, length: 1820, grain: 'short' })
    expect(setRowSize(j, PAIR, { sizeKind: 'custom', width: 0, length: 910, grain: 'long' }).ok).toBe(false)
    // 4×8 は寸法と木目を決まった値にする
    expect(must(setRowSize(j, PAIR, { sizeKind: 'shihachi', width: 1, length: 1, grain: 'short' })).stackSheets[0]).toMatchObject(S48)
  })

  it('組の操作ではひな形が変わらない', () => {
    const base = sampleFlushJob(true)
    const j = must(addRowStock(must(setRowStockMode(must(setRowSize(base, PAIR, S48)), PAIR, true)), PAIR, { ...S36, count: 4 }))
    expect(sameTemplate(templateOf(base), templateOf(j))).toBe(true)
  })
})

describe('削除・コピー', () => {
  it('ラワン 4 を削除すると組の設定が消える（ほかの材料の削除では残る）', () => {
    const base = must(setRowStockMode(sampleFlushJob(true), PAIR, true))
    expect(must(removeBoards(base, [LAUAN_4_ID])).stackSheets).toEqual([])
    expect(must(removeBoards(base, ['board-lauan-2.5'])).stackSheets).toEqual(base.stackSheets)
  })

  it('仕事をコピーすると組の設定と手持ちが新しい id で残る（別のオブジェクト）', () => {
    const base = must(addRowStock(must(setRowStockMode(sampleFlushJob(true), PAIR, true, 'st-1')), PAIR, { ...S48, count: 2 }, 'st-2'))
    const c = copyJob(base, [base.name], NOW, 'job-copy')
    const ids = [c.boards[0].id, c.boards[2].id]
    expect(ids).not.toContain(MELAMINE_1_ID)
    expect(c.stackSheets).toEqual([{ ...base.stackSheets[0], boardIds: ids }])
    expect(c.stackSheets[0].stock).not.toBe(base.stackSheets[0].stock)
    expect(c.stackSheets[0].stock![0]).not.toBe(base.stackSheets[0].stock![0])
  })
})

// S-21 → S-23：まとめの行（材料の行・重ね切りの組の行）の操作と、コピー・削除・見本（第2.3版。architecture.md 15.6・15.9）。
// 組の行は 3×6／4×8 だけ（自由入力・手持ちの操作は断る）
import { describe, expect, it } from 'vitest'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../engine/fixtures/flush'
import { cutFaces } from '../engine/packing/stack'
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
const STACK_ONLY = '重ね切りの組は 3×6 か 4×8 を選んでください'
const must = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const board = (job: Job, id: string) => job.boards.find((b) => b.id === id)!

describe('見本の組の設定', () => {
  it('見本（ひな形から）の組（メラミン 1＋ラワン 4）の設定は 3×6。ラワン 4 の行を 4×8 にしてもメラミン 1 は 3×6 のまま', () => {
    const sample = sampleFromTemplate(defaultTemplate(), NOW)
    const [f] = sample.flushes.filter((x) => x.name === 'フラッシュ25')
    const ids = cutFaces(f, sample.boards).map((x) => x.boardId)
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

  it('組の行では自由入力（手持ち）を選べない：setRowStockMode・addRowStock・updateRowStock・removeRowStock は断る（S-23）', () => {
    const base = sampleFlushJob(true)
    const snap = JSON.stringify(base)
    const no = { ok: false, message: STACK_ONLY }
    expect(setRowStockMode(base, PAIR, true, 'st-1')).toEqual(no)
    expect(setRowStockMode(base, PAIR, false)).toEqual(no)
    expect(addRowStock(base, [LAUAN_4_ID, MELAMINE_1_ID], { ...S48, count: 3 }, 'st-2')).toEqual(no)
    expect(updateRowStock(base, PAIR, 'st-1', { count: 5 })).toEqual(no)
    expect(removeRowStock(base, PAIR, 'st-1')).toEqual(no)
    // 組の設定が無い仕事でも行を作らない
    const empty = { ...base, stackSheets: [] }
    expect(setRowStockMode(empty, PAIR, true)).toEqual(no)
    expect(JSON.stringify(base)).toBe(snap)
  })

  it('組の行の自由入力の大きさ（setRowSize の custom）は断る。3×6／4×8 は寸法と木目を決まった値にする', () => {
    const base = sampleFlushJob(true)
    expect(setRowSize(base, PAIR, { sizeKind: 'custom', width: 910, length: 1820, grain: 'long' })).toEqual({ ok: false, message: STACK_ONLY })
    expect(must(setRowSize(base, PAIR, { sizeKind: 'shihachi', width: 1, length: 1, grain: 'short' })).stackSheets[0]).toEqual({
      boardIds: [MELAMINE_1_ID, LAUAN_4_ID],
      ...S48,
    })
  })

  it('組の行に（以前の版の）手持ちが残っていても、3×6／4×8 を選ぶと手持ちを消す', () => {
    const base = sampleFlushJob(true)
    base.stackSheets[0] = { ...base.stackSheets[0], stockOn: true, stock: [{ id: 'x', ...S36, count: 2 }] }
    expect(must(setRowSize(base, PAIR, S48)).stackSheets).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...S48 }])
  })

  it('材料の行の手持ちを足す・変える・消す。最後の1行を消すと stockOn が外れる。組の行は変わらない', () => {
    const base = sampleFlushJob(true)
    const on = must(setRowStockMode(base, LAUAN_4_ID, true, 'st-1'))
    const two = must(addRowStock(on, LAUAN_4_ID, { ...S48, count: 3 }, 'st-2'))
    expect(board(two, LAUAN_4_ID).stock!.map((s) => [s.id, s.sizeKind, s.count])).toEqual([
      ['st-1', 'saburoku', 1],
      ['st-2', 'shihachi', 3],
    ])
    const upd = must(updateRowStock(two, LAUAN_4_ID, 'st-1', { count: 5 }))
    expect(board(upd, LAUAN_4_ID).stock![0].count).toBe(5)
    expect(updateRowStock(two, LAUAN_4_ID, 'st-1', { count: 0 })).toEqual({ ok: false, message: '枚数は1以上の整数にしてください' })
    expect(updateRowStock(two, LAUAN_4_ID, 'nai', { count: 1 }).ok).toBe(false)
    const one = must(removeRowStock(upd, LAUAN_4_ID, 'st-1'))
    expect(board(one, LAUAN_4_ID).stockOn).toBe(true)
    const none = must(removeRowStock(one, LAUAN_4_ID, 'st-2'))
    expect(board(none, LAUAN_4_ID).stockOn).toBeUndefined()
    expect(board(none, LAUAN_4_ID).stock).toBeUndefined()
    expect(none.stackSheets).toEqual(base.stackSheets)
  })

  it('無い材料・同じ材料2つの組は断る。元の仕事は書き換えない', () => {
    const base = sampleFlushJob(true)
    const snap = JSON.stringify(base)
    expect(setRowSize(base, 'nai', S48)).toEqual({ ok: false, message: '材料が見つかりません' })
    expect(setRowSize(base, [MELAMINE_1_ID, 'nai'], S48).ok).toBe(false)
    expect(setRowSize(base, [LAUAN_4_ID, LAUAN_4_ID], S36).ok).toBe(false)
    must(setRowSize(base, PAIR, S48))
    expect(JSON.stringify(base)).toBe(snap)
  })

  it('材料の行では自由入力の大きさ（以前の自由入力）も選べ、短辺＞長辺は入れ替える。0 以下は断る', () => {
    const j = must(setRowSize(sampleFlushJob(true), LAUAN_4_ID, { sizeKind: 'custom', width: 1820, length: 910, grain: 'short' }))
    expect(board(j, LAUAN_4_ID)).toMatchObject({ sizeKind: 'custom', width: 910, length: 1820, grain: 'short' })
    expect(setRowSize(j, LAUAN_4_ID, { sizeKind: 'custom', width: 0, length: 910, grain: 'long' }).ok).toBe(false)
  })

  it('組の操作ではひな形が変わらない', () => {
    const base = sampleFlushJob(true)
    const j = must(setRowSize(must(setRowSize(base, PAIR, S48)), PAIR, S36))
    expect(sameTemplate(templateOf(base), templateOf(j))).toBe(true)
  })
})

describe('削除・コピー', () => {
  it('ラワン 4 を削除すると組の設定が消える（ほかの材料の削除では残る）', () => {
    const base = must(setRowSize(sampleFlushJob(true), PAIR, S48))
    expect(must(removeBoards(base, [LAUAN_4_ID])).stackSheets).toEqual([])
    expect(must(removeBoards(base, ['board-lauan-2.5'])).stackSheets).toEqual(base.stackSheets)
  })

  it('仕事をコピーすると組の設定が新しい id で残る', () => {
    const base = must(setRowSize(sampleFlushJob(true), PAIR, S48))
    const c = copyJob(base, [base.name], NOW, 'job-copy')
    const ids = [c.boards[0].id, c.boards[2].id]
    expect(ids).not.toContain(MELAMINE_1_ID)
    expect(c.stackSheets).toEqual([{ ...base.stackSheets[0], boardIds: ids }])
  })
})

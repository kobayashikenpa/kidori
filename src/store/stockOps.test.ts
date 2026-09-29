// S-20：手持ちの操作と保存
import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID } from '../engine/fixtures/bookshelf'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { freezeSheet } from '../engine/progress/frozen'
import type { Job } from '../engine/types'
import { addRowStock, copyJob, removeRowStock, setRowSize, setRowStockMode, updateRowStock, type OpResult } from './jobs'
import { JOBS_KEY, loadSaved, saveSaved, sanitizeJobs, type KeyValueStorage } from './storage'

const T1 = new Date('2026-09-27T01:00:00.000Z')

function must(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

/** ランバーを 4×8 にした見本 */
function job48(): Job {
  return must(setRowSize(bookshelfJob(), LUMBER_18_ID, { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' }))
}

const lumber = (job: Job) => job.boards.find((b) => b.id === LUMBER_18_ID)!

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
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

describe('手持ちの操作', () => {
  it('4×8 を選んだ材料で手持ちをオンにすると、行 4×8 ×1 が1つ入る', () => {
    const j = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    expect(lumber(j).stockOn).toBe(true)
    expect(lumber(j).stock).toEqual([{ id: 'st-1', sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long', count: 1 }])
  })

  it('オフにしても行は残り、もう一度オンで同じ行', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const withTwo = must(addRowStock(on, LUMBER_18_ID, { sizeKind: 'saburoku', width: 0, length: 0, grain: 'short', count: 3 }, 'st-2'))
    const off = must(setRowStockMode(withTwo, LUMBER_18_ID, false))
    expect(lumber(off).stockOn).toBeUndefined()
    expect(lumber(off).stock).toEqual(lumber(withTwo).stock)
    const again = must(setRowStockMode(off, LUMBER_18_ID, true, 'st-9'))
    expect(lumber(again).stock).toEqual(lumber(withTwo).stock)
    // 3×6 は寸法と木目を決まった値にする
    expect(lumber(again).stock![1]).toEqual({ id: 'st-2', sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 3 })
  })

  it('枚数 0・1.5 は断られる', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const draft = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
    for (const count of [0, 1.5, -1, Number.NaN]) {
      expect(addRowStock(on, LUMBER_18_ID, { ...draft, count })).toEqual({ ok: false, message: '枚数は1以上の整数にしてください' })
      expect(updateRowStock(on, LUMBER_18_ID, 'st-1', { count })).toEqual({ ok: false, message: '枚数は1以上の整数にしてください' })
    }
  })

  it('自由入力 1820×910 は 910×1820 で入る。0 以下の寸法は断られる', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const j = must(addRowStock(on, LUMBER_18_ID, { sizeKind: 'custom', width: 1820, length: 910, grain: 'short', count: 2 }, 'c'))
    expect(lumber(j).stock![1]).toEqual({ id: 'c', sizeKind: 'custom', width: 910, length: 1820, grain: 'short', count: 2 })
    expect(addRowStock(on, LUMBER_18_ID, { sizeKind: 'custom', width: 0, length: 910, grain: 'long', count: 1 }).ok).toBe(false)
  })

  it('行を変える：枚数だけ・サイズだけ変えられる', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const j = must(updateRowStock(on, LUMBER_18_ID, 'st-1', { count: 5 }))
    expect(lumber(j).stock![0].count).toBe(5)
    const k = must(updateRowStock(j, LUMBER_18_ID, 'st-1', { sizeKind: 'saburoku' }))
    expect(lumber(k).stock![0]).toEqual({ id: 'st-1', sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 5 })
    expect(updateRowStock(k, LUMBER_18_ID, 'nai', { count: 1 }).ok).toBe(false)
  })

  it('最後の1行を消すと stockOn が外れる', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const two = must(addRowStock(on, LUMBER_18_ID, { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 1 }, 'st-2'))
    const one = must(removeRowStock(two, LUMBER_18_ID, 'st-1'))
    expect(lumber(one).stockOn).toBe(true)
    expect(lumber(one).stock!.map((s) => s.id)).toEqual(['st-2'])
    const none = must(removeRowStock(one, LUMBER_18_ID, 'st-2'))
    expect(lumber(none).stockOn).toBeUndefined()
    expect(lumber(none).stock ?? []).toEqual([])
  })

  it('無い材料は断られる。元の仕事は書き換えない', () => {
    const base = job48()
    const snapshot = JSON.stringify(base)
    expect(setRowStockMode(base, 'nai', true).ok).toBe(false)
    must(setRowStockMode(base, LUMBER_18_ID, true))
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('仕事をコピーすると手持ちが残る（別のオブジェクト）', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const c = copyJob(on, [on.name], T1)
    const b = c.boards[on.boards.findIndex((x) => x.id === LUMBER_18_ID)]
    expect(b.stockOn).toBe(true)
    expect(b.stock).toEqual(lumber(on).stock)
    expect(b.stock).not.toBe(lumber(on).stock)
  })
})

describe('手持ちの保存と読み込み', () => {
  it('保存して読み込むと手持ちが残る', () => {
    const on = must(addRowStock(must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1')), LUMBER_18_ID, { sizeKind: 'custom', width: 450, length: 900, grain: 'short', count: 2 }, 'c'))
    const s = memoryStorage()
    saveSaved(s, { jobs: [on], currentJobId: on.id })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('ok')
    expect(lumber(r.data.jobs[0])).toEqual(lumber(on))
  })

  function sanitizeLumber(edit: (b: Record<string, unknown>) => void) {
    const raw = JSON.parse(JSON.stringify(job48())) as Job
    edit(raw.boards.find((b) => b.id === LUMBER_18_ID) as unknown as Record<string, unknown>)
    const r = sanitizeJobs([raw])
    return { board: lumber(r.jobs[0]), fixes: r.fixes }
  }

  const row = { id: 'r1', sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 2 }

  it('正しい手持ちは直さない', () => {
    const r = sanitizeLumber((b) => {
      b.stockOn = true
      b.stock = [row]
    })
    expect(r.fixes).toBe(0)
    expect(r.board.stockOn).toBe(true)
    expect(r.board.stock).toEqual([row])
  })

  it("stockOn: 'yes' は外して直した数に数える", () => {
    const r = sanitizeLumber((b) => {
      b.stockOn = 'yes'
      b.stock = [row]
    })
    expect(r.board.stockOn).toBeUndefined()
    expect(r.board.stock).toEqual([row])
    expect(r.fixes).toBe(1)
  })

  it('枚数が負の行・id の重なる行・種類の違う行は外して数える。行が0になれば stockOn を外す', () => {
    const r = sanitizeLumber((b) => {
      b.stockOn = true
      b.stock = [{ ...row, count: -1 }, { ...row, id: 'r2', count: 1.5 }, { ...row, id: 'r3', sizeKind: 'big' }]
    })
    expect(r.board.stockOn).toBeUndefined()
    expect(r.board.stock ?? []).toEqual([])
    expect(r.fixes).toBe(4)
  })

  it('3×6 の行の寸法が違っていたら 910×1820・木目 長手 に直す。自由入力の短辺＞長辺は入れ替える', () => {
    const r = sanitizeLumber((b) => {
      b.stock = [
        { ...row, width: 900, length: 1800, grain: 'short' },
        { id: 'c', sizeKind: 'custom', width: 900, length: 450, grain: 'long', count: 1 },
      ]
    })
    expect(r.board.stock).toEqual([
      { ...row, width: 910, length: 1820, grain: 'long' },
      { id: 'c', sizeKind: 'custom', width: 450, length: 900, grain: 'long', count: 1 },
    ])
    expect(r.fixes).toBe(2)
  })

  it('stock が配列でなければ外す', () => {
    const r = sanitizeLumber((b) => {
      b.stock = 'x'
    })
    expect(r.board.stock).toBeUndefined()
    expect(r.fixes).toBe(1)
  })

  it('手持ちの無い以前のデータはそのまま（直した数に数えない）', () => {
    const r = sanitizeLumber(() => {})
    expect(r.fixes).toBe(0)
    expect('stock' in r.board).toBe(false)
    expect('stockOn' in r.board).toBe(false)
  })

  it('手持ちの1枚を固定して保存・読み込みしても、1枚の sheet（行と木目）が残る', () => {
    const on = must(setRowStockMode(bookshelfJob(), LUMBER_18_ID, true, 'st-1'))
    const r0 = packJob(on, computeDimensions(on))
    const m = r0.materials.find((x) => x.boardId === LUMBER_18_ID)!
    on.frozenSheets.push({ ...freezeSheet(on, LUMBER_18_ID, m.mode, m.sheets[0], 'f', T1), checked: [m.sheets[0].placements[0].pieceId] })
    const s = memoryStorage()
    saveSaved(s, { jobs: [on], currentJobId: on.id })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0].frozenSheets[0].layout.sheet).toEqual({ stockId: 'st-1', sizeKind: 'saburoku', grain: 'long' })
  })

  it('JOBS_KEY の保存データに手持ちが入る', () => {
    const on = must(setRowStockMode(job48(), LUMBER_18_ID, true, 'st-1'))
    const s = memoryStorage()
    saveSaved(s, { jobs: [on], currentJobId: on.id })
    expect(s.map.get(JOBS_KEY)).toContain('"stockOn":true')
  })
})

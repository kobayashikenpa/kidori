// E-60：まとめのサイズ別の枚数・手持ちの残り・固定した1枚の木目
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import { withStock, type StockRowDraft } from '../fixtures/stock'
import { packJob } from '../packing'
import type { Job } from '../types'
import { freezeSheet, frozenSheetViews, materialSizeCounts, stockUsage } from './frozen'

const NOW = new Date('2026-09-27T00:00:00.000Z')
const pack = (job: Job) => packJob(job, computeDimensions(job))
const lumber = (rows: StockRowDraft[]) => withStock(bookshelfJob(), LUMBER_18_ID, rows)

function sizes(job: Job) {
  const r = pack(job)
  return materialSizeCounts(job, r, frozenSheetViews(job, computeDimensions(job)))
}

function freezeFirst(job: Job, completed: boolean): Job {
  const m = pack(job).materials.find((x) => x.boardId === LUMBER_18_ID)!
  const f = freezeSheet(job, LUMBER_18_ID, m.mode, m.sheets[0], 'f1', NOW)
  if (completed) {
    f.checked = f.layout.placements.map((p) => p.pieceId)
    f.completedAt = NOW.toISOString()
  }
  job.frozenSheets.push(f)
  return job
}

describe('materialSizeCounts（まとめのサイズ別の枚数）', () => {
  it('ランバー 3×6 ×1・4×8 ×1 → 4×8 ×1・3×6 ×1（面積の大きい順）', () => {
    expect(sizes(lumber([['3×6', 1], ['4×8', 1]]))).toEqual([
      { boardId: LUMBER_18_ID, bySize: [{ label: '4×8', count: 1 }, { label: '3×6', count: 1 }] },
      { boardId: VENEER_4_ID, bySize: [{ label: '3×6', count: 1 }] },
    ])
  })

  it('サイズを選んだ材料でも1つ出す（見本は 3×6 ×3）。切り終わりは数えない', () => {
    expect(sizes(bookshelfJob())[0]).toEqual({ boardId: LUMBER_18_ID, bySize: [{ label: '3×6', count: 3 }] })
    expect(sizes(freezeFirst(bookshelfJob(), true))[0].bySize).toEqual([{ label: '3×6', count: 2 }])
  })
})

describe('stockUsage（手持ちの行ごとの使う・残り）', () => {
  it('3×6 ×5・4×8 ×1 → 3×6 は 使う3・残り2、4×8 は 使う0・残り1', () => {
    const job = lumber([['3×6', 5], ['4×8', 1]])
    expect(stockUsage(job, pack(job))).toEqual([
      {
        boardId: LUMBER_18_ID,
        rows: [
          { stockId: 's1', label: '3×6', count: 5, used: 3, left: 2 },
          { stockId: 's2', label: '4×8', count: 1, used: 0, left: 1 },
        ],
      },
    ])
  })

  it('3×6 ×2（棚板が足りない）→ 使う2・残り0', () => {
    const job = lumber([['3×6', 2]])
    expect(stockUsage(job, pack(job))[0].rows).toEqual([{ stockId: 's1', label: '3×6', count: 2, used: 2, left: 0 }])
  })

  it('1枚目を固定しても、切り終わりにしても 3×6 の使う数は変わらない', () => {
    const fixed = freezeFirst(lumber([['3×6', 5]]), false)
    expect(stockUsage(fixed, pack(fixed))[0].rows[0].used).toBe(3)
    const done = freezeFirst(lumber([['3×6', 5]]), true)
    expect(stockUsage(done, pack(done))[0].rows[0]).toMatchObject({ used: 3, left: 2 })
  })

  it('手持ちで木取りしない材料は出さない', () => {
    const job = bookshelfJob()
    expect(stockUsage(job, pack(job))).toEqual([])
  })
})

describe('freezeSheet の木目（手持ちの1枚は行の木目）', () => {
  it('手持ち 自由入力 木目 短手 の1枚を固定すると grain が short', () => {
    const job = lumber([{ width: 1300, length: 2000, grain: 'short', count: 3 }])
    // 木目 H の側板は短手方向の木目の板では 1810 を短辺に通すので入らない。天地板・棚板（木目 W）を並べる
    const m = pack(job).materials.find((x) => x.boardId === LUMBER_18_ID)!
    expect(m.sheets[0].sheet?.grain).toBe('short')
    const f = freezeSheet(job, LUMBER_18_ID, m.mode, m.sheets[0], 'f', NOW)
    expect(f.grain).toBe('short')
    // 選んだサイズの材料は今までどおり材料の木目
    const plain = bookshelfJob()
    const pm = pack(plain).materials[0]
    expect(freezeSheet(plain, LUMBER_18_ID, pm.mode, pm.sheets[0], 'g', NOW).grain).toBe('long')
  })
})

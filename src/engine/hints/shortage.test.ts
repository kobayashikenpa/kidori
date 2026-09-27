// E-59：手持ちが足りないときの解決策
import { describe, expect, it, vi } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { LAUAN_4_ID, sampleFlushJob } from '../fixtures/flush'
import { withStock, type StockRowDraft } from '../fixtures/stock'
import { packJob } from '../packing'
import type { Job } from '../types'
import { findSavingHints } from './saving'
import { stockShortage } from './shortage'

function lumberStock(rows: StockRowDraft[]): Job {
  return withStock(bookshelfJob(), LUMBER_18_ID, rows)
}

vi.mock('../packing', async (importOriginal) => {
  const real = await importOriginal<typeof import('../packing')>()
  return { ...real, packJob: vi.fn(real.packJob) }
})

const run = (job: Job) => stockShortage(job, computeDimensions(job))

describe('stockShortage（手持ちが足りないときの解決策）', () => {
  it('見本のランバー 3×6 ×2 → 棚板が入らない。3×6 は 1枚・4×8 は 1枚、設定の変更では入らない', () => {
    expect(run(lumberStock([['3×6', 2]]))).toEqual([
      {
        boardId: LUMBER_18_ID,
        label: 'シナランバー 18mm',
        missing: ['棚板'],
        add: [
          { kind: 'saburoku', count: 1 },
          { kind: 'shihachi', count: 1 },
        ],
        change: null,
        message: 'シナランバー 18mm が足りません（入らない部材：棚板）',
      },
    ])
  })

  it('4×8 ×1 → 入らない部材 天地板・棚板（部材の並び）、3×6 は 1枚・4×8 は 1枚', () => {
    const [s] = run(lumberStock([['4×8', 1]]))
    expect(s.missing).toEqual(['天地板', '棚板'])
    expect(s.add).toEqual([
      { kind: 'saburoku', count: 1 },
      { kind: 'shihachi', count: 1 },
    ])
    expect(s.message).toBe('シナランバー 18mm が足りません（入らない部材：天地板、棚板）')
  })

  it('側板 410×1810 ×1 だけの仕事で手持ち 自由入力 414×1820 ×1 → 端切りを 4mm にすれば入る', () => {
    const job = lumberStock([{ width: 414, length: 1820, grain: 'long', count: 1 }])
    job.parts = job.parts.filter((p) => p.name === '全体' || p.name === '側板')
    job.parts.find((p) => p.name === '側板')!.quantity = 1
    const [s] = run(job)
    expect(s.missing).toEqual(['側板'])
    expect(s.change).toEqual({ kind: 'trim', value: 4 })
    expect(s.add).toEqual([
      { kind: 'saburoku', count: 1 },
      { kind: 'shihachi', count: 1 },
    ])
  })

  it('足したサイズに入らない片があれば、そのサイズは試さず null', () => {
    // 大板（2510×1260）は 3×6 にも 4×8（使える範囲 1215×2440）にも入らない
    const job = lumberStock([['3×6', 1]])
    job.parts.push({ ...job.parts.find((p) => p.name === '側板')!, id: 'big', name: '大板', expr: { W: '18', H: '2500', D: '1250' }, quantity: 1 })
    const s = run(job).find((x) => x.boardId === LUMBER_18_ID)!
    expect(s.missing).toContain('大板')
    expect(s.add).toEqual([
      { kind: 'saburoku', count: null },
      { kind: 'shihachi', count: null },
    ])
  })

  it('足りない材料が無ければ [] で、packJob を追加で呼ばない', () => {
    const spy = vi.mocked(packJob)
    spy.mockClear()
    const job = lumberStock([['3×6', 3]])
    expect(run(job)).toEqual([])
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
    spy.mockClear()
    // 手持ちの材料が無ければ packJob も呼ばない
    expect(run(bookshelfJob())).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('重ね切りの見本でラワン 4 を手持ち 3×6 ×5 → 背板が入らない。3×6 を 1枚・4×8 を 1枚', () => {
    const job = withStock(sampleFlushJob(true), LAUAN_4_ID, [['3×6', 5]])
    const [s] = run(job)
    expect(s.message).toBe('ラワン 4mm が足りません（入らない部材：背板）')
    // 切り代・端切りを小さくしても組は5枚のままなので、設定の変更では入らない
    expect(s.change).toBeNull()
    expect(s.add).toEqual([
      { kind: 'saburoku', count: 1 },
      { kind: 'shihachi', count: 1 },
    ])
    // 6 にすると知らせが消える
    expect(run(withStock(sampleFlushJob(true), LAUAN_4_ID, [['3×6', 6]]))).toEqual([])
  })

  it('材料を減らせるときのお知らせは、手持ちが足りない材料（とその材料の入る組）に出さない', () => {
    // 端切りを小さくすると3枚 → 2枚になる仕事でも、手持ちが足りなければお知らせは出ない
    const job = lumberStock([['3×6', 2]])
    expect(findSavingHints(job).filter((h) => h.materials.some((m) => m.boardId === LUMBER_18_ID))).toEqual([])
    const stacked = withStock(sampleFlushJob(true), LAUAN_4_ID, [['3×6', 5]])
    expect(findSavingHints(stacked).flatMap((h) => h.materials.map((m) => m.boardId))).not.toContain(LAUAN_4_ID)
    expect(findSavingHints(stacked).flatMap((h) => h.materials.map((m) => m.boardId)).some((id) => id.includes(LAUAN_4_ID))).toBe(false)
  })

  it('部材150枚で 1秒以内', () => {
    const job = bookshelfJob()
    job.parts = job.parts.filter((p) => p.name === '全体')
    for (let i = 0; i < 10; i++) {
      job.parts.push({
        id: `p${i}`,
        name: `部材${i}`,
        boardId: LUMBER_18_ID,
        expr: { W: String(150 + i * 70), H: '18', D: String(200 + ((i * 97) % 500)) },
        thicknessAxis: null,
        quantity: 15,
        grain: i % 2 === 0 ? 'W' : 'any',
        memo: '',
        checks: { finished: false, cut: false },
        allowance: 10,
      })
    }
    withStock(job, LUMBER_18_ID, [['3×6', 3], ['4×8', 1]])
    const t0 = performance.now()
    const [s] = run(job)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(s.add.every((a) => a.count !== null && a.count >= 1)).toBe(true)
  })
})

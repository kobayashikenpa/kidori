// E-58 → 第2.3版で書き直し（E-61）：重ね切りの組と手持ち。
// 組は組の行の手持ち（stackSheets）で並べ、材料の手持ちは使わない・引かない。組に置けなかった片は組の noStock（a・b に回さない）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleFlushJob } from '../fixtures/flush'
import { withStackStock, withStock, type StockRowDraft } from '../fixtures/stock'
import type { Job, MaterialResult } from '../types'
import { packJob } from './index'
import { stackKey, stackPlan } from './stack'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const PAIR = [MELAMINE_1_ID, LAUAN_4_ID] as const
const run = (job: Job) => packJob(job, computeDimensions(job))
const find = (ms: MaterialResult[], id: string) => ms.find((m) => m.boardId === id)

function sample(melamine: StockRowDraft[] | null, lauan: StockRowDraft[] | null, stack: StockRowDraft[] | null = null): Job {
  const job = sampleFlushJob(true)
  if (melamine) withStock(job, MELAMINE_1_ID, melamine)
  if (lauan) withStock(job, LAUAN_4_ID, lauan)
  if (stack) withStackStock(job, PAIR, stack)
  return job
}

/** 片の id（重なりを見る） */
function pieceIds(m: MaterialResult | undefined): string[] {
  return m ? m.sheets.flatMap((s) => s.placements.map((p) => p.pieceId)) : []
}

describe('重ね切りの組と手持ち（第2.3版）', () => {
  it('メラミン 1・ラワン 4 ともに材料の手持ち 3×6 ×6 でも、組は組の設定 3×6 で5枚（材料の手持ちを使わない）。背板はラワン 4 の手持ち', () => {
    const r = run(sample([['3×6', 6]], [['3×6', 6]]))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 5, 0],
      [LAUAN_4_ID, 1, 0],
    ])
    expect(find(r.materials, KEY)!.sheets.every((s) => s.sheet === undefined)).toBe(true)
    expect(find(r.materials, LAUAN_4_ID)!.sheets[0].sheet?.stockId).toBe('s1')
  })

  it('メラミン 1 だけ手持ち 3×6 ×10（ラワン 4 は 3×6 を選択）→ 組 5枚', () => {
    const r = run(sample([['3×6', 10]], null))
    expect(find(r.materials, KEY)!.sheetCount).toBe(5)
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
    expect(find(r.materials, LAUAN_4_ID)!.sheetCount).toBe(1)
  })

  it('メラミン 1 が手持ち 4×8 だけでも（以前は重ねなかった）組は組の設定 3×6 で5枚', () => {
    const job = sample([['4×8', 10]], null)
    expect(stackPlan(job).groups.map((g) => g.key)).toEqual([KEY])
    const r = run(job)
    expect(find(r.materials, KEY)!.sheetCount).toBe(5)
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
  })

  it('組の手持ち 3×6 ×3・ラワン 4 の手持ち 3×6 ×6 → 組 3枚、置けなかった棚板は組の noStock（ラワン 4 に回さない）', () => {
    const r = run(sample(null, [['3×6', 6]], [['3×6', 3]]))
    const stack = find(r.materials, KEY)!
    const lau = find(r.materials, LAUAN_4_ID)!
    expect(stack.sheets.map((s) => s.placements.map((p) => p.name).join(','))).toEqual(['側板,側板', '側板,側板', '天地板,天地板,天地板,天地板'])
    expect(stack.unplaced).toEqual([{ partId: 'part-tana', name: '棚板', reason: 'noStock' }])
    expect(lau.sheets.map((s) => s.placements.map((p) => p.name).join(','))).toEqual(['背板'])
    expect(lau.unplaced).toEqual([])
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
    // 片は重ならない
    const ids = [...pieceIds(stack), ...pieceIds(lau)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('並び：材料 a のふつうの行 → 組の行 → 材料 b（材料の保存の並び）', () => {
    const job = sample(null, null, [['3×6', 3]])
    job.parts.push({ ...job.parts[4], id: 'part-mel', name: 'メラミン板', boardId: MELAMINE_1_ID, expr: { W: '300', H: '300', D: `{t:${MELAMINE_1_ID}}` } })
    expect(run(job).materials.map((m) => m.boardId)).toEqual([MELAMINE_1_ID, KEY, LAUAN_4_ID])
  })

  it('組の固定した1枚で組の手持ちを使い切ると、組の片はすべて組の noStock。ラワン 4 は背板の1枚だけ', () => {
    const job = sample(null, [['3×6', 6]], [['3×6', 1]])
    const stack = find(run(job).materials, KEY)!
    job.frozenSheets.push({
      id: 'f',
      boardId: MELAMINE_1_ID,
      material: 'メラミン',
      thickness: 1,
      grain: 'long',
      mode: 'vertical',
      kerf: 3,
      trim: 5,
      layout: stack.sheets[0],
      checked: [stack.sheets[0].placements[0].pieceId],
      frozenAt: '2026-09-27T00:00:00.000Z',
      stackWith: { boardId: LAUAN_4_ID, material: 'ラワン', thickness: 4 },
    })
    const r = run(job)
    const g = find(r.materials, KEY)!
    expect(g.sheetCount).toBe(0)
    // 固定した1枚の 側板×2 の残り（側板×2）も入らない
    expect(g.unplaced.map((u) => [u.name, u.reason])).toEqual([
      ['側板', 'noStock'],
      ['天地板', 'noStock'],
      ['棚板', 'noStock'],
    ])
    expect(find(r.materials, LAUAN_4_ID)!.sheetCount).toBe(1)
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
  })
})

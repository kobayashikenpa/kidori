// E-58：重ね切りの組と手持ち（組の手持ち・置けなかった片を a・b に回す）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { LAUAN_4_ID, MELAMINE_1_ID, SAMPLE_FLUSH_ID, sampleFlushJob } from '../fixtures/flush'
import { withStock, type StockRowDraft } from '../fixtures/stock'
import type { Job, MaterialResult } from '../types'
import { packJob } from './index'
import { stackKey, stackPlan } from './stack'

const KEY = stackKey(MELAMINE_1_ID, LAUAN_4_ID)
const run = (job: Job) => packJob(job, computeDimensions(job))
const find = (ms: MaterialResult[], id: string) => ms.find((m) => m.boardId === id)

function sample(melamine: StockRowDraft[] | null, lauan: StockRowDraft[] | null): Job {
  const job = sampleFlushJob(true)
  if (melamine) withStock(job, MELAMINE_1_ID, melamine)
  if (lauan) withStock(job, LAUAN_4_ID, lauan)
  return job
}

/** 片の数（pieceId の重なりなし） */
function pieceIds(m: MaterialResult | undefined): string[] {
  return m ? m.sheets.flatMap((s) => s.placements.map((p) => p.pieceId)) : []
}

describe('重ね切りの組と手持ち', () => {
  it('メラミン 1・ラワン 4 ともに手持ち 3×6 ×6 → 組 5枚・ラワン 4 のふつうの1枚 1枚（背板）・入らない部材なし', () => {
    const r = run(sample([['3×6', 6]], [['3×6', 6]]))
    expect(r.materials.map((m) => [m.boardId, m.sheetCount, m.unplaced.length])).toEqual([
      [KEY, 5, 0],
      [LAUAN_4_ID, 1, 0],
    ])
    expect(find(r.materials, KEY)!.sheets.every((s) => s.sheet?.stockId === 's1')).toBe(true)
    expect(r.stackMismatches).toEqual([])
  })

  it('メラミン 1 だけ手持ち 3×6 ×10（ラワン 4 は 3×6 を選択）→ 組 5枚', () => {
    const r = run(sample([['3×6', 10]], null))
    expect(find(r.materials, KEY)!.sheetCount).toBe(5)
    expect(find(r.materials, MELAMINE_1_ID)).toBeUndefined()
    expect(find(r.materials, LAUAN_4_ID)!.sheetCount).toBe(1)
  })

  it('メラミン 1 が手持ち 3×6 ×3・ラワン 4 が手持ち 3×6 ×6 → 組 3枚。置けなかった片はメラミン 1 で noStock、ラワン 4 ではふつうに並ぶ', () => {
    const job = sample([['3×6', 3]], [['3×6', 6]])
    const r = run(job)
    const stack = find(r.materials, KEY)!
    const mel = find(r.materials, MELAMINE_1_ID)!
    const lau = find(r.materials, LAUAN_4_ID)!
    expect(stack.sheetCount).toBe(3)
    expect(stack.unplaced).toEqual([])
    // メラミン 1 は手持ちを組で使い切ったので、残りの片は入らない
    expect(mel.sheetCount).toBe(0)
    expect(mel.unplaced.length).toBeGreaterThan(0)
    expect(mel.unplaced.every((u) => u.reason === 'noStock')).toBe(true)
    // ラワン 4 は組の3枚を引いた残り3枚に、組に置けなかった片（棚板×8）と背板を並べる
    expect(stack.sheets.map((s) => s.placements.map((p) => p.name).join(','))).toEqual(['側板,側板', '側板,側板', '天地板,天地板,天地板,天地板'])
    expect(lau.sheets.map((s) => s.placements.map((p) => p.name).join(','))).toEqual(['背板', '棚板,棚板,棚板,棚板', '棚板,棚板,棚板,棚板'])
    expect(stack.sheetCount + lau.sheetCount).toBe(6)
    expect(lau.unplaced).toEqual([])
    expect(mel.unplaced).toEqual([{ partId: 'part-tana', name: '棚板', reason: 'noStock' }])
    // 片は重ならず、ラワンは組の片＋ふつうの片で、フラッシュの片（16）＋背板（1）をすべて切る（入らない分を除く）
    const lauIds = [...pieceIds(stack), ...pieceIds(lau)]
    expect(new Set(lauIds).size).toBe(lauIds.length)
    const lauMissing = lau.unplaced.length
    if (lauMissing === 0) expect(lauIds).toHaveLength(17)
    // b（ラワン）の片の id は b の表面材の番号（組の片の id と重ならない）
    const stackIds = new Set(pieceIds(stack))
    expect(pieceIds(lau).some((id) => stackIds.has(id))).toBe(false)
    // メラミンの入らない部材は、組に置けなかったフラッシュの部材
    expect(mel.unplaced.map((u) => u.name).every((n) => ['側板', '天地板', '棚板'].includes(n))).toBe(true)
  })

  it('組が手持ちを使うときの並び：材料の行 → 組の行（材料の保存の並び）', () => {
    const r = run(sample([['3×6', 3]], [['3×6', 6]]))
    expect(r.materials.map((m) => m.boardId)).toEqual([MELAMINE_1_ID, KEY, LAUAN_4_ID])
  })

  it('メラミン 1 が手持ち 4×8 だけ・ラワン 4 が 3×6 の選択 → 組は無く、stackMismatches の理由は stock', () => {
    const job = sample([['4×8', 10]], null)
    expect(stackPlan(job)).toEqual({
      groups: [],
      mismatches: [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], flushIds: [SAMPLE_FLUSH_ID], reason: 'stock' }],
    })
    const r = run(job)
    expect(find(r.materials, KEY)).toBeUndefined()
    expect(r.stackMismatches).toEqual([{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], flushIds: [SAMPLE_FLUSH_ID], reason: 'stock' }])
    expect(find(r.materials, MELAMINE_1_ID)!.sheets.every((s) => s.sheet?.sizeKind === 'shihachi')).toBe(true)
  })

  it('手持ちを使わないで大きさがそろわない組は、今までどおり理由を持たない（size）', () => {
    const job = sampleFlushJob(true)
    job.boards[0] = { ...job.boards[0], sizeKind: 'shihachi', width: 1220, length: 2440 }
    expect(stackPlan(job).mismatches[0].reason).toBeUndefined()
  })

  it('組の手持ちを使い切っただけなら組のまま（固定した組の1枚で引いても組は残る）', () => {
    const job = sample([['3×6', 1]], [['3×6', 6]])
    const r = run(job)
    const stack = find(r.materials, KEY)!
    // 組の固定
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
    expect(stackPlan(job).groups.map((g) => g.key)).toEqual([KEY])
    const r2 = run(job)
    // 組の手持ちは 0 枚なので組の結果は1枚も無く、片はそれぞれの材料に回る
    expect(find(r2.materials, KEY)?.sheetCount ?? 0).toBe(0)
    expect(find(r2.materials, MELAMINE_1_ID)!.unplaced.every((u) => u.reason === 'noStock')).toBe(true)
    // ラワンは 6 − 1（固定した組の1枚）＝ 5 枚まで
    expect(find(r2.materials, LAUAN_4_ID)!.sheetCount).toBeLessThanOrEqual(5)
  })
})

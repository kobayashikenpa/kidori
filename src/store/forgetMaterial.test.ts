// 第2.8版：部材の編集の上で開いた設定の画面で材料・材料グループを消したあと、下書きを保存する（forgetMissingMaterial → addPart / updatePart）
import { describe, expect, it } from 'vitest'
import { FLUSH_25_ID, flushJob, LAUAN_4_ID, MELAMINE_1_ID } from '../engine/fixtures/flush'
import type { Job } from '../engine/types'
import { addPart, forgetMissingMaterial, newPart, removeBoards, removeFlushes, updatePart, type OpResult } from './jobs'

const ok = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

describe('forgetMissingMaterial', () => {
  it('材料があれば、そのまま返す', () => {
    const job = flushJob()
    const p = newPart({ name: '幕板', boardId: LAUAN_4_ID })
    expect(forgetMissingMaterial(job, p)).toBe(p)
    const g = job.parts[0]
    expect(forgetMissingMaterial(job, g)).toBe(g)
  })

  it('下書きの材料を消した → 未設定に戻して追加できる', () => {
    const draft = newPart({ name: '幕板', boardId: MELAMINE_1_ID, expr: { W: '900', H: '100', D: '1' } })
    const job = ok(removeBoards(flushJob(), [MELAMINE_1_ID]))
    const fixed = forgetMissingMaterial(job, draft)
    expect(fixed.boardId).toBeNull()
    const saved = ok(addPart(job, fixed))
    expect(saved.parts.find((p) => p.name === '幕板')?.boardId).toBeNull()
  })

  it('編集中の部材の材料グループを消した → 材料グループを外して保存できる', () => {
    const before = flushJob()
    const draft = before.parts[0] // 天板（フラッシュ25）
    const job = ok(removeFlushes(before, [FLUSH_25_ID]))
    // 下書きのまま保存すると断られる（材料グループが見つからない）
    expect(updatePart(job, draft.id, draft).ok).toBe(false)
    const fixed = forgetMissingMaterial(job, draft)
    expect(fixed.flushId).toBeUndefined()
    expect(fixed.boardId).toBeNull()
    const saved = ok(updatePart(job, draft.id, fixed)).parts.find((p) => p.id === draft.id)!
    expect(saved.flushId).toBeUndefined()
    expect('flushId' in saved).toBe(false)
    expect(saved.boardId).toBeNull()
  })
})

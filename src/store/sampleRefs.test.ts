// 見本（本棚 W900）で、式の逃げの id のつけ替えと、仕事で使っている材料・フラッシュ・逃げ（第2.4版 E-65）
import { describe, expect, it } from 'vitest'
import { jobRefIds, remapBoardIds, remapRefIds } from '../engine/formula/usages'
import { SAMPLE_FLUSH_NAME, sampleJob } from './sample'

const NOW = new Date('2026-09-28T10:00:00.000Z')

describe('見本の式の逃げのつけ替え（remapRefIds）', () => {
  it('棚板の W 天地板.W - {n:A} が {n:B} になり、部材の参照と {t:} は変わらない', () => {
    const job = sampleJob(NOW)
    const tana = job.parts.find((p) => p.name === '棚板')!
    const nige1 = job.settings.nige.find((n) => n.value === 1)!
    expect(tana.expr.W).toBe(`天地板.W - {n:${nige1.id}}`)
    const nige = new Map([[nige1.id, 'nige-B']])
    expect(remapRefIds(tana.expr.W, { nige })).toBe('天地板.W - {n:nige-B}')
    expect(remapRefIds(tana.expr.H, { nige })).toBe(tana.expr.H)
    // thickness の表だけ渡せば remapBoardIds と同じ
    const thickness = new Map([[tana.flushId!, 'flush-B']])
    for (const p of job.parts) {
      for (const a of ['W', 'H', 'D'] as const) {
        expect(remapRefIds(p.expr[a], { thickness })).toBe(remapBoardIds(p.expr[a], thickness))
      }
    }
    expect(remapRefIds(tana.expr.H, { thickness })).toBe('{t:flush-B}')
  })
})

describe('見本の jobRefIds', () => {
  it('材料 芯材15・メラミン1・ラワン4、フラッシュ25、逃げ1 だけ（ラワン2.5・5.5・逃げ0.5 は入らない）', () => {
    const job = sampleJob(NOW)
    const r = jobRefIds(job)
    const boards = job.boards.filter((b) => r.boardIds.has(b.id)).map((b) => `${b.material}${b.thickness}`)
    expect(boards.sort()).toEqual(['メラミン1', 'ラワン4', '芯材15'])
    expect(r.boardIds.size).toBe(3)
    expect(job.flushes.filter((f) => r.flushIds.has(f.id)).map((f) => f.name)).toEqual([SAMPLE_FLUSH_NAME])
    expect(r.flushIds.size).toBe(1)
    expect(job.settings.nige.filter((n) => r.nigeIds.has(n.id)).map((n) => n.value)).toEqual([1])
    expect(r.nigeIds.size).toBe(1)
  })
})

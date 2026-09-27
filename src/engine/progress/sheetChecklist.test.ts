import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { packJob } from '../packing'
import type { Job } from '../types'
import { sheetChecklist } from './sheetChecklist'

const sheetsOf = (job: Job) => packJob(job, computeDimensions(job)).materials.find((m) => m.boardId === LUMBER_18_ID)!.sheets

describe('sheetChecklist（1枚ごとのチェックリスト）', () => {
  it('1片1行、placements の並び。チェックした行だけ done', () => {
    const job = bookshelfJob()
    const [, second] = sheetsOf(job)
    const rows = sheetChecklist(job, second, [second.placements[1].pieceId])
    expect(rows.map((r) => [r.pieceId, r.name, r.sizeLabel, r.done])).toEqual(
      second.placements.map((p, i) => [p.pieceId, p.name, p.sizeLabel, i === 1]),
    )
    expect(rows.every((r) => r.partId === second.placements.find((p) => p.pieceId === r.pieceId)!.partId)).toBe(true)
  })

  it('部材名を変えると行の名前もついてくる。部材を消すと写しの名前', () => {
    const job = bookshelfJob()
    const [first] = sheetsOf(job)
    const renamed = { ...job, parts: job.parts.map((p) => (p.name === '側板' ? { ...p, name: '側板L' } : p)) }
    expect(sheetChecklist(renamed, first, []).map((r) => r.name)).toEqual(['側板L', '側板L'])
    const removed = { ...job, parts: job.parts.filter((p) => p.name !== '側板') }
    expect(sheetChecklist(removed, first, []).map((r) => r.name)).toEqual(['側板', '側板'])
  })

  it('寸法は写し（計算の結果）のまま。今の寸法が変わっても変わらない', () => {
    const job = bookshelfJob()
    const [first] = sheetsOf(job)
    const changed = { ...job, parts: job.parts.map((p) => (p.name === '全体' ? { ...p, expr: { ...p.expr, H: '1500' } } : p)) }
    expect(sheetChecklist(changed, first, []).map((r) => r.sizeLabel)).toEqual(['1810×410', '1810×410'])
  })
})

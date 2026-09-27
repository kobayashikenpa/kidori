// 第1.8版（切りながら進める木取り）：見本（第1.7版の見本。ひな形は初期値、材料は 3×6）で確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { freezeSheet, frozenDemand } from '../engine/progress/frozen'
import type { Job, MaterialResult } from '../engine/types'
import { sampleFromTemplate } from './sample'
import { defaultTemplate } from './template'

const NOW = new Date('2026-09-27T09:00:00.000Z')

function sample(): Job {
  return sampleFromTemplate(defaultTemplate(), NOW)
}
const boardId = (job: Job, material: string, thickness: number) =>
  job.boards.find((b) => b.material === material && b.thickness === thickness)!.id
const partId = (job: Job, name: string) => job.parts.find((p) => p.name === name)!.id
const materialOf = (job: Job, id: string): MaterialResult | undefined =>
  packJob(job, computeDimensions(job)).materials.find((m) => m.boardId === id)
const names = (m: MaterialResult | undefined, i: number) => m!.sheets[i].placements.map((p) => p.name)

describe('E-42 見本：メラミン 1 の1枚目を写す', () => {
  it('材料名・厚み・木目・切り方・刃厚3・端切り5 が写り、写しは深いコピー。側板|メラミン が 2', () => {
    const job = sample()
    const mel = boardId(job, 'メラミン', 1)
    const m = materialOf(job, mel)!
    expect(m.sheetCount).toBe(5)
    expect(names(m, 0)).toEqual(['側板', '側板'])
    const f = freezeSheet(job, mel, m.mode, m.sheets[0], 'sheet-1', NOW)
    expect(f).toMatchObject({ material: 'メラミン', thickness: 1, grain: 'long', mode: 'vertical', kerf: 3, trim: 5 })
    const before = JSON.parse(JSON.stringify(m.sheets[0]))
    m.sheets[0].placements[0].w = 1
    m.sheets[0].cuts.pop()
    expect(f.layout).toEqual(before)
    const d = frozenDemand({ frozenSheets: [f] })
    expect(d.get(`${partId(job, '側板')}|${mel}`)).toBe(2)
    expect(d.size).toBe(1)
    expect(job.frozenSheets).toEqual([])
  })
})

// 第1.8版（切りながら進める木取り）：見本（第1.7版の見本。ひな形は初期値、材料は 3×6）で確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { compareStandardSizes } from '../engine/packing/sizes'
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

/** 今の計算の i 枚目を固定する（チェックは先頭の片） */
function freezeAt(job: Job, board: string, i: number): Job {
  const m = materialOf(job, board)!
  const f = freezeSheet(job, board, m.mode, m.sheets[i], `sheet-${job.frozenSheets.length + 1}`, NOW)
  f.checked = [f.layout.placements[0].pieceId]
  return { ...job, frozenSheets: [...job.frozenSheets, f] }
}

describe('E-43 見本：固定した片を木取りの計算から除く', () => {
  it('メラミン 1 の1枚目（側板×2）を固定すると メラミン 1 は 4枚、ほかの材料は変わらない', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const lau = boardId(job0, 'ラワン', 4)
    const before = packJob(job0, computeDimensions(job0))
    const job = freezeAt(job0, mel, 0)
    const r = packJob(job, computeDimensions(job))
    const m = r.materials.find((x) => x.boardId === mel)!
    expect(m.sheetCount).toBe(4)
    expect([0, 1, 2, 3].map((i) => names(m, i))).toEqual([
      ['側板', '側板'],
      ['天地板', '天地板', '天地板', '天地板'],
      ['棚板', '棚板', '棚板', '棚板'],
      ['棚板', '棚板', '棚板', '棚板'],
    ])
    expect(r.materials.find((x) => x.boardId === lau)).toEqual(before.materials.find((x) => x.boardId === lau))
    expect(r.done).toEqual([])
    expect(r.skipped).toEqual([])
  })

  it('ラワン 4 の1枚目（背板）を固定すると ラワン 4 は 5枚', () => {
    const job0 = sample()
    const lau = boardId(job0, 'ラワン', 4)
    expect(materialOf(job0, lau)!.sheetCount).toBe(6)
    expect(names(materialOf(job0, lau), 0)).toEqual(['背板'])
    const job = freezeAt(job0, lau, 0)
    expect(materialOf(job, lau)!.sheetCount).toBe(5)
    expect(materialOf(job, lau)!.sheets.flatMap((s) => s.placements.map((p) => p.name))).not.toContain('背板')
  })

  it('サイズの比較（compareStandardSizes）のメラミン 1（3×6）も 4枚', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const job = freezeAt(job0, mel, 0)
    const c = compareStandardSizes(job, computeDimensions(job)).find((x) => x.boardId === mel)!
    expect(c.options.find((o) => o.kind === 'saburoku')!.sheetCount).toBe(4)
  })

  it('以前の cutByBoard の完了がある部材は今までどおり done に出る', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const tana = partId(job0, '棚板')
    let job = freezeAt(job0, mel, 0)
    job = {
      ...job,
      parts: job.parts.map((p) => (p.id === tana ? { ...p, checks: { ...p.checks, cutByBoard: { [mel]: true } } } : p)),
    }
    const r = packJob(job, computeDimensions(job))
    expect(r.done).toEqual([{ partId: tana, name: '棚板', quantity: 8, boardId: mel }])
    expect(r.materials.find((x) => x.boardId === mel)!.sheetCount).toBe(2)
  })
})

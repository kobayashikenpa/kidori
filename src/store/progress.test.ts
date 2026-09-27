// 第1.8版（切りながら進める木取り）：見本（第1.7版の見本。ひな形は初期値、材料は 3×6）で確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { compareStandardSizes } from '../engine/packing/sizes'
import { freezeSheet, frozenDemand, frozenSheetViews, materialSummaries } from '../engine/progress/frozen'
import { sheetChecklist } from '../engine/progress/sheetChecklist'
import { sheetProgress } from '../engine/progress/sheetProgress'
import type { Job, MaterialResult } from '../engine/types'
import { removePart, updatePart } from './jobs'
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

describe('E-44 見本：メラミン 1 の1枚目の進み具合', () => {
  it('右の側板 → 済んだ工程 [1,2,3]・次は 4・残り 492×1820。両方 → [1〜5]・次は無し・端材 79×1820', () => {
    const job = sample()
    const m = materialOf(job, boardId(job, 'メラミン', 1))!
    const s = m.sheets[0]
    const right = s.placements.find((p) => p.x > 400)!.pieceId
    const left = s.placements.find((p) => p.x < 400)!.pieceId
    expect(s.cuts[3].label).toBe('右端から 410mm で縦に切る')
    const one = sheetProgress(s, job.settings.kerf, [right])
    expect(one).toEqual({
      doneSteps: [1, 2, 3],
      nextStep: 4,
      remaining: [{ rect: { x: 0, y: 0, w: 492, h: 1820 }, pieceIds: [left] }],
    })
    const both = sheetProgress(s, job.settings.kerf, [right, left])
    expect(both).toEqual({ doneSteps: [1, 2, 3, 4, 5], nextStep: null, remaining: [{ rect: { x: 0, y: 0, w: 79, h: 1820 }, pieceIds: [] }] })
    expect(sheetProgress(s, job.settings.kerf, [])).toMatchObject({ doneSteps: [], nextStep: 1 })
  })

  it('横切り優先の1枚目（側板 1810×410 ×2）で上の側板 → 済んだ工程 [1,2,3,4]・次は 5', () => {
    const job0 = sample()
    const job = { ...job0, settings: { ...job0.settings, cutMode: 'horizontal' as const } }
    const s = materialOf(job, boardId(job, 'メラミン', 1))!.sheets[0]
    expect(s.placements.map((p) => p.sizeLabel)).toEqual(['1810×410', '1810×410'])
    const top = s.placements.find((p) => p.y > 400)!.pieceId
    expect(sheetProgress(s, 3, [top])).toMatchObject({ doneSteps: [1, 2, 3, 4], nextStep: 5 })
  })
})

describe('E-45 見本：部材が変わっています・材料のまとめ', () => {
  const must = (r: ReturnType<typeof updatePart>): Job => {
    if (!r.ok) throw new Error(r.message)
    return r.job
  }
  const drift = (job: Job) => frozenSheetViews(job, computeDimensions(job))[0].drift.map((d) => `${d.name}:${d.reason}`)

  it('ラワン 4 の1枚目（背板）を固定：全体.W 880 → 背板 size、背板 0枚 → count、背板を消す → removed、棚板を増やす → なし', () => {
    const job0 = sample()
    const job = freezeAt(job0, boardId(job0, 'ラワン', 4), 0)
    expect(drift(job)).toEqual([])
    const all = partId(job, '全体')
    expect(drift(must(updatePart(job, all, { expr: { W: '880', H: '1800', D: '400' } })))).toEqual(['背板:size'])
    expect(drift(must(updatePart(job, partId(job, '背板'), { quantity: 0 })))).toEqual(['背板:count'])
    expect(drift(must(removePart(job, partId(job, '背板'))))).toEqual(['背板:removed'])
    expect(drift(must(updatePart(job, partId(job, '棚板'), { quantity: 6 })))).toEqual([])
    // 写しは 900×1800 のまま
    const changed = must(updatePart(job, all, { expr: { W: '880', H: '1800', D: '400' } }))
    expect(frozenSheetViews(changed, computeDimensions(changed))[0].sheet.layout.placements[0].sizeLabel).toBe('900×1800')
  })

  it('メラミン 1 の1枚目：チェック1つ → 枚数 5、チェック2つ（切り終わり）→ 枚数 4・切り終わり 1', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const summary = (job: Job) => {
      const dims = computeDimensions(job)
      return materialSummaries(job, packJob(job, dims), frozenSheetViews(job, dims)).materials.find((m) => m.boardId === mel)!
    }
    expect(summary(job0)).toMatchObject({ sheetCount: 5, completedCount: 0 })
    const one = freezeAt(job0, mel, 0)
    expect(summary(one)).toMatchObject({ sheetCount: 5, completedCount: 0 })
    const f = one.frozenSheets[0]
    const both: Job = {
      ...one,
      frozenSheets: [{ ...f, checked: f.layout.placements.map((p) => p.pieceId), completedAt: NOW.toISOString() }],
    }
    expect(summary(both)).toMatchObject({ sheetCount: 4, completedCount: 1 })
  })
})

describe('E-46 見本：1枚ごとのチェックリスト', () => {
  it('メラミン 1 の3枚目（天地板×4）で「天地板 860×410」が4行。1つにチェックした写しではその行だけ done。部材名を変えるとついてくる', () => {
    const job = sample()
    const mel = boardId(job, 'メラミン', 1)
    const third = materialOf(job, mel)!.sheets[2]
    const rows = sheetChecklist(job, third, [])
    expect(rows.map((r) => `${r.name} ${r.sizeLabel} ${r.done}`)).toEqual(Array(4).fill('天地板 860×410 false'))
    const f = freezeSheet(job, mel, 'vertical', third, 's', NOW)
    f.checked = [third.placements[2].pieceId]
    expect(sheetChecklist(job, f.layout, f.checked).map((r) => r.done)).toEqual([false, false, true, false])
    const renamed = updatePart(job, partId(job, '天地板'), { name: '天板' })
    if (!renamed.ok) throw new Error(renamed.message)
    expect(sheetChecklist(renamed.job, f.layout, f.checked).map((r) => r.name)).toEqual(Array(4).fill('天板'))
  })
})

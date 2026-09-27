// 第1.8版（切りながら進める木取り）：見本（第1.7版の見本。ひな形は初期値、材料は 3×6）で確かめる
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import { compareStandardSizes } from '../engine/packing/sizes'
import { freezeSheet, frozenDemand, frozenSheetViews, materialSummaries } from '../engine/progress/frozen'
import { sheetChecklist } from '../engine/progress/sheetChecklist'
import { sheetProgress } from '../engine/progress/sheetProgress'
import type { Job, MaterialResult } from '../engine/types'
import { removePart, setPieceCheck, updatePart, type OpResult } from './jobs'
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

describe('S-15 見本：1枚ごとのチェックの付け外し（setPieceCheck）', () => {
  const ok = (r: OpResult): Job => {
    if (!r.ok) throw new Error(r.message)
    return r.job
  }
  const LATER = new Date('2026-09-27T10:00:00.000Z')

  it('計算した1枚の側板にチェック → 固定1つ（checked 1）→ もう1つで切り終わり → 1つ外すと戻る → 全部外すと固定が消えて 5枚', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const m = materialOf(job0, mel)!
    const layout = m.sheets[0]
    const [a, b] = layout.placements.map((p) => p.pieceId)

    const j1 = ok(setPieceCheck(job0, { kind: 'computed', boardId: mel, mode: m.mode, layout }, a, true, NOW, 'sheet-x'))
    expect(j1.frozenSheets).toHaveLength(1)
    expect(j1.frozenSheets[0]).toMatchObject({ id: 'sheet-x', boardId: mel, checked: [a], frozenAt: NOW.toISOString() })
    expect(j1.frozenSheets[0].completedAt).toBeUndefined()
    expect(j1.frozenSheets[0].layout).toEqual(layout)
    expect(j1.frozenSheets[0].layout).not.toBe(layout)
    expect(materialOf(j1, mel)!.sheetCount).toBe(4)
    expect(job0.frozenSheets).toEqual([])

    const target = { kind: 'frozen', sheetId: 'sheet-x' } as const
    const j2 = ok(setPieceCheck(j1, target, b, true, LATER))
    expect(j2.frozenSheets[0].checked).toEqual([a, b])
    expect(j2.frozenSheets[0].completedAt).toBe(LATER.toISOString())
    // 同じチェックをもう一度付けても重ならない・切り終わりの時刻は変えない
    const again = ok(setPieceCheck(j2, target, b, true, new Date('2026-09-28T00:00:00.000Z')))
    expect(again.frozenSheets[0]).toEqual(j2.frozenSheets[0])

    const j3 = ok(setPieceCheck(j2, target, a, false, LATER))
    expect(j3.frozenSheets[0].checked).toEqual([b])
    expect(j3.frozenSheets[0].completedAt).toBeUndefined()
    expect('completedAt' in j3.frozenSheets[0]).toBe(false)

    const j4 = ok(setPieceCheck(j3, target, b, false, LATER))
    expect(j4.frozenSheets).toEqual([])
    expect(materialOf(j4, mel)!.sheetCount).toBe(5)
  })

  it('計算した1枚のチェックを外す（done=false）は何もしない。片が1つだけの1枚は、チェック1つで切り終わり', () => {
    const job0 = sample()
    const lau = boardId(job0, 'ラワン', 4)
    const m = materialOf(job0, lau)!
    const layout = m.sheets[0]
    const pid = layout.placements[0].pieceId
    const t = { kind: 'computed', boardId: lau, mode: m.mode, layout } as const
    expect(ok(setPieceCheck(job0, t, pid, false, NOW))).toBe(job0)
    const j = ok(setPieceCheck(job0, t, pid, true, NOW, 's'))
    expect(j.frozenSheets[0].completedAt).toBe(NOW.toISOString())
  })

  it('写しに無い pieceId・無い1枚・無い材料は失敗', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const m = materialOf(job0, mel)!
    const layout = m.sheets[0]
    expect(setPieceCheck(job0, { kind: 'computed', boardId: mel, mode: m.mode, layout }, 'none#1', true).ok).toBe(false)
    expect(setPieceCheck(job0, { kind: 'computed', boardId: 'board-x', mode: m.mode, layout }, layout.placements[0].pieceId, true).ok).toBe(false)
    expect(setPieceCheck(job0, { kind: 'frozen', sheetId: 'none' }, layout.placements[0].pieceId, true).ok).toBe(false)
    const j = ok(setPieceCheck(job0, { kind: 'computed', boardId: mel, mode: m.mode, layout }, layout.placements[0].pieceId, true, NOW, 's'))
    expect(setPieceCheck(j, { kind: 'frozen', sheetId: 's' }, 'none#1', true).ok).toBe(false)
    expect(setPieceCheck(j, { kind: 'frozen', sheetId: 's' }, 'none#1', false).ok).toBe(false)
  })

  it('2枚目を固定すると固定した1枚の最後に足される（固定した順）', () => {
    const job0 = sample()
    const mel = boardId(job0, 'メラミン', 1)
    const m = materialOf(job0, mel)!
    const t = (i: number) => ({ kind: 'computed', boardId: mel, mode: m.mode, layout: m.sheets[i] }) as const
    let j = ok(setPieceCheck(job0, t(1), m.sheets[1].placements[0].pieceId, true, NOW, 'a'))
    const m2 = materialOf(j, mel)!
    j = ok(setPieceCheck(j, { kind: 'computed', boardId: mel, mode: m2.mode, layout: m2.sheets[0] }, m2.sheets[0].placements[0].pieceId, true, NOW, 'b'))
    expect(j.frozenSheets.map((f) => f.id)).toEqual(['a', 'b'])
    expect(materialOf(j, mel)!.sheetCount).toBe(3)
  })
})

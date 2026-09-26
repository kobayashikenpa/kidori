import { describe, expect, it } from 'vitest'
import { computeDimensions } from './dimensions'
import { explainDimension, explanationText } from './dimensions/explain'
import { FLUSH_25_ID, flushJob, flushPart, LAUAN_4_ID, MELAMINE_1_ID } from './fixtures/flush'
import {
  flushBreakdown,
  flushBreakdownText,
  flushesEmptiedByBoards,
  flushesUsingBoards,
  flushThickness,
  partsUsingFlushes,
  partThicknessSource,
  thicknessOfId,
  thicknessRefLabel,
} from './flush'
import { formulaLabels } from './formula/display'
import type { Job } from './types'

function dims(job: Job) {
  return Object.fromEntries(computeDimensions(job).parts.map((p) => [p.name, p]))
}

describe('flushThickness（フラッシュの厚み）', () => {
  it('仕様書の例：芯材15＋メラミン1×2＋ラワン4×2＝25', () => {
    const job = flushJob()
    expect(flushThickness(job.flushes[0], job.boards)).toBe(25)
  })

  it('小数の材料（ラワン2.5×2＋芯材12）＝17', () => {
    const boards = [{ id: 'b', thickness: 2.5 }]
    expect(flushThickness({ core: 12, faces: [{ boardId: 'b', count: 2 }] }, boards)).toBe(17)
  })

  it('見つからない材料の表面材は数えない', () => {
    expect(flushThickness({ core: 15, faces: [{ boardId: 'なし', count: 2 }] }, [])).toBe(15)
  })

  it('thicknessOfId は材料の厚みとフラッシュの合計の厚みを返す。無い id は null', () => {
    const job = flushJob()
    expect(thicknessOfId(job, MELAMINE_1_ID)).toBe(1)
    expect(thicknessOfId(job, FLUSH_25_ID)).toBe(25)
    expect(thicknessOfId(job, 'なし')).toBeNull()
  })

  it('式の表示名：材料は メラミン1、フラッシュは名前', () => {
    const job = flushJob()
    expect(thicknessRefLabel(job, MELAMINE_1_ID)).toBe('メラミン1')
    expect(thicknessRefLabel(job, FLUSH_25_ID)).toBe('フラッシュ25')
    expect(thicknessRefLabel(job, 'なし')).toBeNull()
    expect(formulaLabels(`{t:${FLUSH_25_ID}}*2`, job)).toEqual(['フラッシュ25', '×', '2'])
  })

  it('partThicknessSource：フラッシュの部材は合計の厚み、材料の部材は材料の厚み、未設定は null', () => {
    const job = flushJob()
    expect(partThicknessSource(job, job.parts[0])).toEqual({ thickness: 25 })
    expect(partThicknessSource(job, { boardId: LAUAN_4_ID })).toEqual({ thickness: 4 })
    expect(partThicknessSource(job, { boardId: null })).toBeNull()
    expect(partThicknessSource(job, { boardId: null, flushId: 'なし' })).toBeNull()
  })
})

describe('フラッシュの部材の厚みの判定', () => {
  it('天板（W900・H25・D600）はフラッシュの厚み 25 の H を自動で選び、面は W・D', () => {
    const d = dims(flushJob())['天板']
    expect(d.thicknessAxis).toBe('H')
    expect(d.thicknessAuto).toBe(true)
    expect(d.thicknessMismatch).toBe(false)
    expect(d.faceAxes).toEqual(['W', 'D'])
    expect(d.cutSize).toEqual({ W: 910, H: 25, D: 610 })
    expect(d.errors).toEqual([])
  })

  it('厚みが 24（1mm 足りない）なら、フラッシュの厚み 25 と合わないエラー', () => {
    const job = flushJob()
    job.parts[0].expr.H = '24'
    const d = dims(job)['天板']
    expect(d.thicknessMismatch).toBe(true)
    expect(d.errors.map((e) => e.kind)).toEqual(['thicknessMismatch'])
    expect(d.errors[0].message).toContain('材料の厚み 25')
  })

  it('表面材の枚数を変えると厚みもついてくる（メラミン1×1 → 24 で一致）', () => {
    const job = flushJob()
    job.flushes[0].faces[0].count = 1
    job.parts[0].expr.H = '24'
    expect(dims(job)['天板'].thicknessMismatch).toBe(false)
  })

  it('式の厚み {t:フラッシュ} は合計の厚み：幕板.H = 天板.H + {t:flush} → 50', () => {
    const job = flushJob()
    job.parts.push(
      flushPart({ id: 'p2', name: '幕板', boardId: LAUAN_4_ID, expr: { W: '900', H: `天板.H + {t:${FLUSH_25_ID}}`, D: '4' } }),
    )
    expect(dims(job)['幕板'].finished).toEqual({ W: 900, H: 50, D: 4 })
    const e = explainDimension(job, 'p2', 'H')!
    expect(explanationText(e)).toBe('天板.H 25 + フラッシュ25 = 50')
  })

  it('削除したフラッシュを式で使うとエラー（削除した材料と同じ）', () => {
    const job = flushJob()
    job.parts.push(flushPart({ id: 'p2', name: '幕板', boardId: LAUAN_4_ID, expr: { W: '900', H: '{t:flush-なし}', D: '4' } }))
    const d = dims(job)['幕板']
    expect(d.errors.map((e) => e.kind)).toContain('missingBoard')
    expect(formulaLabels('{t:flush-なし}', job)).toEqual(['（削除した材料）'])
  })
})

describe('flushBreakdown（厚みの内訳）', () => {
  it('芯材15 ＋ メラミン1×2 ＋ ラワン4×2 ＝ 25', () => {
    const b = flushBreakdown(flushJob(), FLUSH_25_ID)!
    expect(b.core).toBe(15)
    expect(b.faces).toEqual([
      { boardId: MELAMINE_1_ID, label: 'メラミン1', thickness: 1, count: 2 },
      { boardId: LAUAN_4_ID, label: 'ラワン4', thickness: 4, count: 2 },
    ])
    expect(b.total).toBe(25)
    expect(flushBreakdownText(b)).toBe('芯材15 ＋ メラミン1×2 ＋ ラワン4×2 ＝ 25')
  })

  it('無いフラッシュは null', () => {
    expect(flushBreakdown(flushJob(), 'なし')).toBeNull()
  })
})

describe('使っているものの一覧', () => {
  it('材料を使っているフラッシュの名前', () => {
    const job = flushJob()
    expect(flushesUsingBoards(job, [LAUAN_4_ID])).toEqual(['フラッシュ25'])
    expect(flushesUsingBoards(job, ['なし'])).toEqual([])
  })

  it('材料を削除すると表面材が無くなるフラッシュの名前', () => {
    const job = flushJob()
    expect(flushesEmptiedByBoards(job, [LAUAN_4_ID])).toEqual([])
    expect(flushesEmptiedByBoards(job, [LAUAN_4_ID, MELAMINE_1_ID])).toEqual(['フラッシュ25'])
  })

  it('フラッシュを選んでいる部材の名前', () => {
    expect(partsUsingFlushes(flushJob(), [FLUSH_25_ID])).toEqual(['天板'])
  })
})

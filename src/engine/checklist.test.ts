import { describe, expect, it } from 'vitest'
import { computeDimensions } from './dimensions'
import { cuttingChecklist, type CutChecklistRow } from './checklist'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from './fixtures/bookshelf'
import { flushJob, flushPart, LAUAN_4_ID, MELAMINE_1_ID } from './fixtures/flush'
import type { Job } from './types'

const list = (job: Job) => cuttingChecklist(job, computeDimensions(job))
const brief = (r: CutChecklistRow) => [r.partName, r.sizeLabel, r.count, r.done, r.kind]

describe('cuttingChecklist（切り出しのチェックリスト。木取り画面）', () => {
  it('見本（本棚 W900）：材料ごとに、部材の並びで木取り寸法と枚数が並ぶ。枚数0の全体は出ない', () => {
    const groups = list(bookshelfJob())
    expect(groups.map((g) => g.board?.id)).toEqual([LUMBER_18_ID, VENEER_4_ID])
    expect(groups[0].rows.map(brief)).toEqual([
      ['側板', '1810×410', 2, false, 'part'],
      ['天地板', '874×410', 2, false, 'part'],
      ['棚板', '873×390', 4, false, 'part'],
    ])
    expect(groups[1].rows.map(brief)).toEqual([['背板', '900×1800', 1, false, 'part']])
    expect(groups[0].rows[0]).toMatchObject({ partId: 'part-gawaita', boardId: LUMBER_18_ID, size: [1810, 410] })
  })

  it('木取りの完了（checks.cut）が done に出る', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) => (p.name === '棚板' ? { ...p, checks: { finished: false, cut: true } } : p))
    expect(list(job)[0].rows.map((r) => r.done)).toEqual([false, false, true])
  })

  it('フラッシュの部材は表面材ごと：枚数＝表面材の枚数×部材の枚数、完了は cutByBoard。ふつうの部材と同じ材料のリストに並ぶ', () => {
    const job = flushJob()
    job.parts = [
      { ...job.parts[0], checks: { finished: false, cut: false, cutByBoard: { [MELAMINE_1_ID]: true } } },
      flushPart({ id: 'part-back', name: '背板', boardId: LAUAN_4_ID, expr: { W: '900', H: '600', D: '4' } }),
    ]
    const groups = list(job)
    expect(groups.map((g) => g.board?.id)).toEqual([MELAMINE_1_ID, LAUAN_4_ID])
    expect(groups[0].rows.map(brief)).toEqual([['天板', '910×610', 4, true, 'flushFace']])
    expect(groups[1].rows.map(brief)).toEqual([
      ['天板', '910×610', 4, false, 'flushFace'],
      ['背板', '910×610', 1, false, 'part'],
    ])
  })

  it('材料が未設定・寸法のエラーのある部材は出さない。ただし木取りを完了にした部材は、寸法が出せなくても出す（外せるように）', () => {
    const job = bookshelfJob()
    job.parts = [
      ...job.parts,
      flushPart({ id: 'p-nob', name: '未設定', expr: { W: '100', H: '18', D: '100' } }),
      flushPart({ id: 'p-err', name: '誤り', boardId: LUMBER_18_ID, expr: { W: '天板.W', H: '18', D: '100' } }),
      flushPart({ id: 'p-thick', name: '厚み違い', boardId: LUMBER_18_ID, expr: { W: '100', H: '20', D: '100' } }),
      flushPart({
        id: 'p-errdone',
        name: '誤り済',
        boardId: LUMBER_18_ID,
        expr: { W: '天板.W', H: '18', D: '100' },
        checks: { finished: false, cut: true },
      }),
    ]
    const names = list(job).flatMap((g) => g.rows.map((r) => r.partName))
    expect(names).toEqual(['側板', '天地板', '棚板', '誤り済', '背板'])
    const row = list(job)[0].rows[3]
    expect(row).toMatchObject({ size: null, sizeLabel: '－', done: true })
  })

  it('部材が無ければ空', () => {
    const job = bookshelfJob()
    job.parts = []
    expect(list(job)).toEqual([])
  })
})

describe('cuttingChecklist：材料が未設定の完了の行', () => {
  it('完了にしたあと材料を外した部材は、最後の「材料が未設定」の組（board が null）に出る。完了でなければ出ない', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) =>
      p.name === '棚板' ? { ...p, boardId: null, checks: { finished: false, cut: true } } : p.name === '背板' ? { ...p, boardId: null } : p,
    )
    const groups = list(job)
    const last = groups[groups.length - 1]
    expect(last.board).toBeNull()
    expect(last.rows.map((r) => [r.partName, r.done, r.kind, r.boardId])).toEqual([['棚板', true, 'part', '']])
    expect(groups.slice(0, -1).every((g) => g.board !== null)).toBe(true)
  })

  it('削除した材料を指す完了の部材も「材料が未設定」に出る', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) => (p.name === '背板' ? { ...p, checks: { finished: false, cut: true } } : p))
    job.boards = job.boards.filter((b) => b.id !== VENEER_4_ID)
    const groups = list(job)
    expect(groups.map((g) => g.board?.id ?? null)).toEqual([LUMBER_18_ID, null])
    expect(groups[1].rows.map((r) => r.partName)).toEqual(['背板'])
  })
})

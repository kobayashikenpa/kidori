// 第1.8版：固定した1枚の片を、部材の枚数から数だけで引いてから片にする（architecture.md 11.3）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import { flushJob, LAUAN_4_ID, MELAMINE_1_ID } from '../fixtures/flush'
import { freezeSheet } from '../progress/frozen'
import type { Job } from '../types'
import { packJob } from '.'
import { expandPieces } from './pieces'

const NOW = new Date('2026-09-27T09:00:00.000Z')
const pack = (job: Job) => packJob(job, computeDimensions(job))
const expand = (job: Job) => expandPieces(job, computeDimensions(job))

/** 今の計算の i 枚目を固定した1枚として足す（チェックは先頭の片だけ） */
function freeze(job: Job, boardId: string, i: number, id = `sheet-${job.frozenSheets.length + 1}`): Job {
  const m = pack(job).materials.find((x) => x.boardId === boardId)!
  const f = freezeSheet(job, boardId, m.mode, m.sheets[i], id, NOW)
  f.checked = [f.layout.placements[0].pieceId]
  return { ...job, frozenSheets: [...job.frozenSheets, f] }
}

describe('expandPieces・packJob：固定した片を計算から除く', () => {
  it('固定が無ければ今までどおり（ランバー 3枚・ベニヤ 1枚）', () => {
    const r = pack(bookshelfJob())
    expect(r.materials.map((m) => m.sheetCount)).toEqual([3, 1])
  })

  it('ランバーの1枚目（側板×2）を固定すると、ランバーは2枚。側板は done にも skipped にも出ない', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    const r = pack(job)
    const lumber = r.materials.find((m) => m.boardId === LUMBER_18_ID)!
    expect(lumber.sheetCount).toBe(2)
    expect(lumber.sheets.flatMap((s) => s.placements.map((p) => p.name))).not.toContain('側板')
    expect(r.materials.find((m) => m.boardId === VENEER_4_ID)!.sheetCount).toBe(1)
    expect(r.done).toEqual([])
    expect(r.skipped).toEqual([])
  })

  it('一部だけ引く：側板を1枚ぶん固定すると、残りの側板は1枚。片の id の連番は 1 から', () => {
    let job = bookshelfJob()
    const m = pack(job).materials[0]
    const f = freezeSheet(job, LUMBER_18_ID, m.mode, m.sheets[0], 's', NOW)
    f.layout.placements = f.layout.placements.slice(0, 1)
    job = { ...job, frozenSheets: [f] }
    const g = expand(job).groups.find((x) => x.board.id === LUMBER_18_ID)!
    expect(g.pieces.filter((p) => p.name === '側板').map((p) => p.pieceId)).toEqual(['part-gawaita#1'])
    expect(g.pieces).toHaveLength(7)
  })

  it('数だけで引く：固定したあと寸法を変えても引き続ける', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    job.parts = job.parts.map((p) => (p.name === '全体' ? { ...p, expr: { ...p.expr, H: '1700' } } : p))
    const names = pack(job).materials[0].sheets.flatMap((s) => s.placements.map((p) => p.name))
    expect(names).not.toContain('側板')
  })

  it('固定した数が今の枚数より多くても 0 未満にしない（枚数を 1 に減らす）', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    job.parts = job.parts.map((p) => (p.name === '側板' ? { ...p, quantity: 1 } : p))
    const r = pack(job)
    expect(r.materials[0].sheetCount).toBe(2)
    expect(r.done).toEqual([])
    expect(r.skipped).toEqual([])
  })

  it('枚数を増やすと、増えた分だけ計算した1枚に並ぶ', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    job.parts = job.parts.map((p) => (p.name === '側板' ? { ...p, quantity: 3 } : p))
    const g = expand(job).groups.find((x) => x.board.id === LUMBER_18_ID)!
    expect(g.pieces.filter((p) => p.name === '側板').map((p) => p.pieceId)).toEqual(['part-gawaita#1'])
  })

  it('全部固定した部材は、今は寸法のエラーがあっても skipped に出さない', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    job.parts = job.parts.map((p) => (p.name === '側板' ? { ...p, expr: { ...p.expr, D: '(' } } : p))
    const r = pack(job)
    expect(r.skipped.map((s) => s.name)).not.toContain('側板')
  })

  it('ほかの材料の固定した片は引かない（キーは部材×材料）', () => {
    const job = freeze(bookshelfJob(), VENEER_4_ID, 0)
    const r = pack(job)
    expect(r.materials.map((m) => m.boardId)).toEqual([LUMBER_18_ID])
    expect(r.materials[0].sheetCount).toBe(3)
  })

  it('以前の木取り済み（checks.cut）は今までどおり done に出る', () => {
    const job = freeze(bookshelfJob(), LUMBER_18_ID, 0)
    job.parts = job.parts.map((p) => (p.name === '棚板' ? { ...p, checks: { ...p.checks, cut: true } } : p))
    const r = pack(job)
    expect(r.done.map((d) => d.name)).toEqual(['棚板'])
    expect(r.materials[0].sheets.flatMap((s) => s.placements.map((p) => p.name)).sort()).toEqual(['天地板', '天地板'])
  })

  it('フラッシュ：表面材ごとに引く（メラミン 1 の天板2枚ぶんを固定すると、メラミン 1 の天板は 2枚、ラワン 4 は 4枚のまま）', () => {
    let job = flushJob()
    const before = expand(job)
    expect(before.groups.map((g) => g.pieces.length)).toEqual([4, 4])
    const m = pack(job).materials.find((x) => x.boardId === MELAMINE_1_ID)!
    const f = freezeSheet(job, MELAMINE_1_ID, m.mode, m.sheets[0], 's', NOW)
    // 1枚に天板は1枚しか入らないので、2枚目・3枚目を固定する
    const g = freezeSheet(job, MELAMINE_1_ID, m.mode, m.sheets[1], 't', NOW)
    expect(f.layout.placements).toHaveLength(1)
    job = { ...job, frozenSheets: [f, g] }
    const after = expand(job)
    expect(after.groups.find((g) => g.board.id === MELAMINE_1_ID)!.pieces).toHaveLength(2)
    expect(after.groups.find((g) => g.board.id === LAUAN_4_ID)!.pieces).toHaveLength(4)
  })

  it('フラッシュの表面材の以前の完了（cutByBoard）は今までどおり done', () => {
    const job = flushJob()
    job.parts = job.parts.map((p) => ({ ...p, checks: { ...p.checks, cutByBoard: { [LAUAN_4_ID]: true } } }))
    const r = pack(freeze(job, MELAMINE_1_ID, 0))
    expect(r.done).toEqual([{ partId: 'part-tenban', name: '天板', quantity: 4, boardId: LAUAN_4_ID }])
  })
  it('フラッシュ：ある表面材を固定しても、ほかの表面材の片の id はずれない（全部固定・一部固定とも）', () => {
    const job0 = flushJob()
    const lauanIds = (job: Job) => expand(job).groups.find((g) => g.board.id === LAUAN_4_ID)!.pieces.map((p) => p.pieceId)
    const ids = lauanIds(job0)
    expect(ids).toEqual(['part-tenban#5', 'part-tenban#6', 'part-tenban#7', 'part-tenban#8'])
    let job = freeze(job0, MELAMINE_1_ID, 0)
    expect(expand(job).groups[0].pieces.map((p) => p.pieceId)).toEqual(['part-tenban#1', 'part-tenban#2', 'part-tenban#3'])
    expect(lauanIds(job)).toEqual(ids)
    for (let i = 0; i < 3; i++) job = freeze(job, MELAMINE_1_ID, 0)
    expect(expand(job).groups.map((g) => g.board.id)).toEqual([LAUAN_4_ID])
    expect(lauanIds(job)).toEqual(ids)
  })
})

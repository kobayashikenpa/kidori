// E-81 1枚の片を部材ごとにまとめたチェックリスト（第2.7版。architecture.md 19.6）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import { LAUAN_4_ID, MELAMINE_1_ID, sampleGroupJob } from '../fixtures/flush'
import { packJob } from '../packing'
import { stackKey } from '../packing/stack'
import type { Job } from '../types'
import { sheetChecklist, sheetPartChecklist } from './sheetChecklist'

const sheetsOf = (job: Job, boardId: string) =>
  packJob(job, computeDimensions(job)).materials.find((m) => m.boardId === boardId)!.sheets
const shape = (rows: ReturnType<typeof sheetPartChecklist>) => rows.map((r) => [r.name, r.pieceIds.length, r.done])

describe('sheetPartChecklist（E-81）', () => {
  it('本棚の見本（縦切り優先）の2枚目：天地板 ×2・棚板 ×2 の2行（切る順）', () => {
    const job = bookshelfJob()
    const second = sheetsOf(job, LUMBER_18_ID)[1]
    const rows = sheetPartChecklist(job, second, [])
    expect(shape(rows)).toEqual([
      ['天地板', 2, false],
      ['棚板', 2, false],
    ])
    expect(rows.map((r) => r.partId)).toEqual(['part-tenchiita', 'part-tanaita'])
    // 片は今の sheetChecklist の並び
    expect(rows.flatMap((r) => r.pieceIds)).toEqual(sheetChecklist(job, second, []).map((r) => r.pieceId))
    const first = second.placements.find((p) => p.pieceId === rows[0].pieceIds[0])!
    expect(rows[0].sizeLabel).toBe(first.sizeLabel)
  })

  it('本棚の見本の1枚目：側板 ×2 の1行', () => {
    const job = bookshelfJob()
    expect(shape(sheetPartChecklist(job, sheetsOf(job, LUMBER_18_ID)[0], []))).toEqual([['側板', 2, false]])
  })

  it('片が全部チェック済みの行だけ done。棚板の片の1つだけなら false（以前のデータ）', () => {
    const job = bookshelfJob()
    const second = sheetsOf(job, LUMBER_18_ID)[1]
    const [tenchi, tana] = sheetPartChecklist(job, second, [])
    const rows = sheetPartChecklist(job, second, [...tenchi.pieceIds, tana.pieceIds[0]])
    expect(shape(rows)).toEqual([
      ['天地板', 2, true],
      ['棚板', 2, false],
    ])
  })

  it('部材名は今の名前。部材が無ければ写しの名前', () => {
    const job = bookshelfJob()
    const second = sheetsOf(job, LUMBER_18_ID)[1]
    const renamed = { ...job, parts: job.parts.map((p) => (p.id === 'part-tanaita' ? { ...p, name: '中棚' } : p)).filter((p) => p.id !== 'part-tenchiita') }
    expect(sheetPartChecklist(renamed, second, []).map((r) => r.name)).toEqual(['天地板', '中棚'])
  })

  it('フラッシュ25 のメラミン1 の1枚：同じ部材の表と裏の片が1行にまとまる', () => {
    const job = sampleGroupJob(false)
    const sheets = sheetsOf(job, MELAMINE_1_ID)
    for (const s of sheets) {
      const rows = sheetPartChecklist(job, s, [])
      expect(new Set(rows.map((r) => r.partId)).size).toBe(rows.length)
      expect(rows.reduce((n, r) => n + r.pieceIds.length, 0)).toBe(s.placements.length)
    }
    // 側板（4片＝2枚×表裏）の1枚目
    const rows = sheetPartChecklist(job, sheets[0], [])
    expect(shape(rows)).toEqual([['側板', 2, false]])
    expect(rows[0].pieceIds).toEqual(['part-gawa#1', 'part-gawa#2'])
  })

  it('重ねた板の1枚でも同じ形（×◯枚は配置図の数）', () => {
    const job = sampleGroupJob(true)
    const sheets = sheetsOf(job, stackKey(MELAMINE_1_ID, LAUAN_4_ID))
    const rows = sheetPartChecklist(job, sheets[0], [])
    expect(rows.reduce((n, r) => n + r.pieceIds.length, 0)).toBe(sheets[0].placements.length)
    expect(new Set(rows.map((r) => r.partId)).size).toBe(rows.length)
    expect(rows[0].name).toBe('側板')
  })
})

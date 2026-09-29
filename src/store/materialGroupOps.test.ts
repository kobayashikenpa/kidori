// S-29：材料・材料グループの操作（木取りしない・中身の検査・自動の名前）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { CORE_15_ID, LAUAN_4_ID, MELAMINE_1_ID, SAMPLE_FLUSH_ID, sampleGroupJob } from '../engine/fixtures/flush'
import { formulaLabels } from '../engine/formula/display'
import { stackPlan } from '../engine/packing/stack'
import type { Job } from '../engine/types'
import { addBoard, addFlush, newBoard, refreshAutoNames, removeBoards, updateBoard, updateFlush, type OpResult } from './jobs'

const ok = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const msg = (r: OpResult): string => {
  if (r.ok) throw new Error('断られなかった')
  return r.message
}
const flushOf = (job: Job, id = SAMPLE_FLUSH_ID) => job.flushes.find((f) => f.id === id)!

describe('updateBoard：木取りしない（noCut）の付け外し', () => {
  it('メラミン1 を木取りしないにすると フラッシュ25 の stack が外れ、組の行は残る', () => {
    const job = sampleGroupJob(true)
    const j = ok(updateBoard(job, MELAMINE_1_ID, { noCut: true }))
    expect(j.boards.find((b) => b.id === MELAMINE_1_ID)!.noCut).toBe(true)
    expect(flushOf(j).stack).toBeUndefined()
    expect(j.stackSheets).toEqual(job.stackSheets)
    expect(stackPlan(j).groups).toEqual([])
  })

  it('木取りしないを外すと noCut のキーが消える。芯材15 を外すと重ね切りも外れる', () => {
    const job = sampleGroupJob(true)
    const j = ok(updateBoard(job, CORE_15_ID, { noCut: undefined }))
    const core = j.boards.find((b) => b.id === CORE_15_ID)!
    expect('noCut' in core).toBe(false)
    expect(flushOf(j).stack).toBeUndefined()
  })

  it('厚みを変えても重ね切りが続けられるなら残す', () => {
    const j = ok(updateBoard(sampleGroupJob(true), LAUAN_4_ID, { thickness: 5 }))
    expect(flushOf(j).stack).toBe(true)
  })
})

describe('自動の名前（refreshAutoNames）', () => {
  it('ラワン4 の厚みを 5 にすると 自動の名前の フラッシュ25 が フラッシュ27 になり、式の表示名もついてくる', () => {
    const job = sampleGroupJob(true)
    const j = ok(updateBoard(job, LAUAN_4_ID, { thickness: 5 }))
    expect(flushOf(j).name).toBe('フラッシュ27')
    const tenchi = j.parts.find((p) => p.name === '天地板')!
    expect(formulaLabels(tenchi.expr.H, j)).toEqual(['フラッシュ27'])
    expect(computeDimensions(j).parts.find((p) => p.name === '天地板')!.finished?.H).toBe(27)
  })

  it('手で名前を付けた材料グループは変わらない', () => {
    const job = sampleGroupJob(true)
    job.flushes[0] = { ...job.flushes[0], name: '本棚用' }
    delete job.flushes[0].autoName
    const j = ok(updateBoard(job, LAUAN_4_ID, { thickness: 5 }))
    expect(flushOf(j).name).toBe('本棚用')
  })

  it('フラッシュ27 がすでにあれば フラッシュ27-2', () => {
    let job = sampleGroupJob(true)
    job = ok(addFlush(job, { name: 'フラッシュ27', faces: [{ boardId: LAUAN_4_ID, count: 1 }] }, 'f-27'))
    const j = ok(updateBoard(job, LAUAN_4_ID, { thickness: 5 }))
    expect(j.flushes.map((f) => f.name)).toEqual(['フラッシュ27-2', 'フラッシュ27'])
  })

  it('形ごとの頭：ベタ20・グループ15。すでに正しい名前（-2 も）は変えない', () => {
    let job = sampleGroupJob()
    job = ok(addFlush(job, { name: 'ベタ9', faces: [{ boardId: LAUAN_4_ID, count: 2 }, { boardId: MELAMINE_1_ID, count: 1 }], form: 'beta', autoName: true }, 'g-b'))
    job = ok(addFlush(job, { name: 'グループ15', faces: [{ boardId: CORE_15_ID, count: 1 }], form: 'empty', autoName: true }, 'g-e'))
    job = ok(addFlush(job, { name: 'フラッシュ25-2', faces: [{ boardId: CORE_15_ID, count: 1 }, { boardId: LAUAN_4_ID, count: 2 }, { boardId: MELAMINE_1_ID, count: 2 }], form: 'flush', autoName: true }, 'g-f'))
    const j = refreshAutoNames(job)
    expect(j.flushes.map((f) => f.name)).toEqual(['フラッシュ25', 'ベタ9', 'グループ15', 'フラッシュ25-2'])
  })

  it('updateFlush で中身を変えると自動の名前がついてくる', () => {
    const job = sampleGroupJob(true)
    const f = flushOf(job)
    const j = ok(updateFlush(job, f.id, { ...f, faces: f.faces.map((x) => (x.boardId === MELAMINE_1_ID ? { ...x, count: 1 } : x)), stack: undefined }))
    expect(flushOf(j).name).toBe('フラッシュ24')
  })

  it('メラミン1 を削除すると中身から外れ、名前がついてくる（重ね切りも外れる）', () => {
    const j = ok(removeBoards(sampleGroupJob(true), [MELAMINE_1_ID]))
    const f = flushOf(j)
    expect(f.faces.map((x) => x.boardId)).toEqual([CORE_15_ID, LAUAN_4_ID])
    expect(f.name).toBe('フラッシュ23')
    expect(f.stack).toBeUndefined()
  })
})

describe('validateFlush（材料グループの検査）', () => {
  const job = () => sampleGroupJob()
  it('中身が0・空欄の行・同じ材料の2行・枚数 0 はそれぞれの文言で断る', () => {
    expect(msg(addFlush(job(), { name: 'グループ0', faces: [] }))).toBe('中身を1つ以上入れてください')
    expect(msg(addFlush(job(), { name: 'ベタ1', faces: [{ boardId: '', count: 1 }, { boardId: MELAMINE_1_ID, count: 1 }] }))).toBe(
      '中身の材料を選んでください',
    )
    expect(msg(addFlush(job(), { name: 'x', faces: [{ boardId: MELAMINE_1_ID, count: 1 }, { boardId: MELAMINE_1_ID, count: 2 }] }))).toBe(
      '「メラミン 1mm」が重なっています（枚数でまとめてください）',
    )
    expect(msg(addFlush(job(), { name: 'x', faces: [{ boardId: MELAMINE_1_ID, count: 0 }] }))).toBe('中身の枚数は 1 以上の整数を入れてください')
    expect(msg(addFlush(job(), { name: 'x', faces: [{ boardId: 'なし', count: 1 }] }))).toBe('中身の材料が見つかりません')
  })

  it('重ねて切れないのに stack なら断る（芯材15 は数えない）', () => {
    const faces = [
      { boardId: CORE_15_ID, count: 1 },
      { boardId: MELAMINE_1_ID, count: 1 },
    ]
    expect(msg(addFlush(job(), { name: 'x', faces, stack: true }))).toBe('重ねて切れるのは、木取りする中身が2種類で枚数が同じときだけです')
    const ok2 = addFlush(job(), { name: 'x', faces: [...faces, { boardId: LAUAN_4_ID, count: 1 }], stack: true })
    expect(ok2.ok).toBe(true)
  })

  it('core の無い下書きで addFlush できる。form・autoName は正しい値だけ残す', () => {
    const j = ok(
      addFlush(job(), { name: ' ベタ5 ', faces: [{ boardId: LAUAN_4_ID, count: 1 }, { boardId: MELAMINE_1_ID, count: 1 }], form: 'beta', autoName: true }, 'g1'),
    )
    expect(j.flushes.at(-1)).toEqual({
      id: 'g1',
      name: 'ベタ5',
      faces: [
        { boardId: LAUAN_4_ID, count: 1 },
        { boardId: MELAMINE_1_ID, count: 1 },
      ],
      form: 'beta',
      autoName: true,
    })
    const j2 = ok(addFlush(job(), { name: 'y', faces: [{ boardId: LAUAN_4_ID, count: 1 }], form: 'x' as never, autoName: false as never }, 'g2'))
    expect(j2.flushes.at(-1)).toEqual({ id: 'g2', name: 'y', faces: [{ boardId: LAUAN_4_ID, count: 1 }] })
  })

  it('材料の名前と重なる名前・材料グループと同じ表示名の材料は「材料グループ」の文言で断る', () => {
    expect(msg(addBoard(sampleGroupJob(), newBoard({ material: 'フラッシュ', thickness: 25 })))).toBe(
      '「フラッシュ25」は材料グループと同じ名前です。材料名か厚みを変えてください',
    )
  })
})

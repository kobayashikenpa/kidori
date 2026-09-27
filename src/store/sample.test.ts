import { describe, expect, it } from 'vitest'
import { orderedBoards } from '../engine/boards'
import { computeDimensions } from '../engine/dimensions'
import { flushThickness } from '../engine/flush'
import { packJob } from '../engine/packing'
import { stackKey } from '../engine/packing/stack'
import type { Job } from '../engine/types'
import {
  addBoard,
  addFlush,
  addNige,
  boardLabel,
  createJob,
  newBoard,
  removeBoards,
  removeNiges,
  updateFlush,
  updateSettings,
  type JobOp,
  type OpResult,
} from './jobs'
import { applyOp, initialState, storeReducer, type StoreState } from './reducer'
import { SAMPLE_NAME, sampleFromTemplate } from './sample'
import { defaultTemplate, templateOf } from './template'

const NOW = new Date('2026-09-26T10:00:00.000Z')

function must(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

const dimOf = (job: Job, name: string) => computeDimensions(job).parts.find((p) => p.name === name)!
const finishedOf = (job: Job, name: string) => dimOf(job, name).finished
const partOf = (job: Job, name: string) => job.parts.find((p) => p.name === name)!
const boardOf = (job: Job, material: string, thickness: number) =>
  job.boards.filter((b) => b.material === material && b.thickness === thickness)

describe('sampleFromTemplate（見本をひな形から作る。フラッシュ25 と ラワン4 だけ）', () => {
  it('初期値のひな形から：材料は初期の4つのまま・フラッシュ25・逃げ0.5・1、寸法と木取りは見本の表どおり', () => {
    const job = sampleFromTemplate(defaultTemplate(), NOW)
    expect(job.name).toBe(SAMPLE_NAME)
    expect(orderedBoards(job).map(boardLabel)).toEqual(['メラミン 1mm', 'ラワン 2.5mm', 'ラワン 4mm', 'ラワン 5.5mm'])
    // 見本で使う材料は 3×6、使わない材料は 4×8 のまま
    for (const [m, t] of [['メラミン', 1], ['ラワン', 4]] as const) {
      expect(boardOf(job, m, t)[0]).toMatchObject({ sizeKind: 'saburoku', width: 910, length: 1820 })
    }
    expect(boardOf(job, 'ラワン', 2.5)[0].sizeKind).toBe('shihachi')
    expect(job.settings.nige.map((n) => n.value)).toEqual([0.5, 1])
    expect(job.flushes.map((f) => [f.name, f.core, flushThickness(f, job.boards)])).toEqual([['フラッシュ25', 15, 25]])

    expect(computeDimensions(job).errors).toEqual([])
    expect(finishedOf(job, '側板')).toEqual({ W: 25, H: 1800, D: 400 })
    expect(finishedOf(job, '天地板')).toEqual({ W: 850, H: 25, D: 400 })
    expect(finishedOf(job, '棚板')).toEqual({ W: 849, H: 25, D: 380 })
    expect(finishedOf(job, '背板')).toEqual({ W: 900, H: 1800, D: 4 })
    expect(dimOf(job, '側板').cutSize).toMatchObject({ H: 1810, D: 410 })
    expect(dimOf(job, '天地板').cutSize).toMatchObject({ W: 860, D: 410 })
    expect(dimOf(job, '棚板').cutSize).toMatchObject({ W: 859, D: 390 })
    expect(dimOf(job, '背板').cutSize).toMatchObject({ W: 900, H: 1800 })
    for (const name of ['側板', '天地板', '棚板']) expect(partOf(job, name).flushId).toBe(job.flushes[0].id)
    expect(partOf(job, '背板').boardId).toBe(boardOf(job, 'ラワン', 4)[0].id)

    // 見本が足したフラッシュ25 は重ね切りオン（第2.1版）：組 5枚・ラワン 4 のふつうの1枚は背板の1枚
    expect(job.flushes[0].stack).toBe(true)
    const mel = boardOf(job, 'メラミン', 1)[0].id
    const lauan = boardOf(job, 'ラワン', 4)[0].id
    for (const cutMode of ['vertical', 'horizontal', 'auto'] as const) {
      const j = must(updateSettings(job, { cutMode }))
      const r = packJob(j, computeDimensions(j))
      expect(r.materials.map((m) => [m.boardId, m.stack?.boardIds ?? null, m.sheetCount])).toEqual([
        [stackKey(mel, lauan), [mel, lauan], 5],
        [lauan, null, 1],
      ])
      expect(r.materials.map((m) => Math.round(m.yieldRate * 1000) / 10)).toEqual([85.2, 97.8])
      expect(Math.round(r.totalYieldRate * 1000) / 10).toBe(86.4)
      expect(r.skipped).toEqual([])
      expect(r.stackMismatches).toEqual([])
    }
    // 重ね切りをオフにすると第1.7版の見本（S-14）の値
    const { stack: _s, ...offDraft } = job.flushes[0]
    const off = must(updateFlush(job, job.flushes[0].id, offDraft))
    const r = packJob(off, computeDimensions(off))
    expect(r.materials.map((m) => [boardLabel(m), m.sheetCount])).toEqual([
      ['メラミン 1mm', 5],
      ['ラワン 4mm', 6],
    ])
    expect(r.materials.map((m) => Math.round(m.yieldRate * 1000) / 10)).toEqual([85.2, 87.3])
  })

  it('厚みは式の厚みで書く：材料・フラッシュの厚みを変えると寸法がついてくる', () => {
    const job = sampleFromTemplate(defaultTemplate(), NOW)
    const flushT = `{t:${job.flushes[0].id}}`
    expect(partOf(job, '側板').expr.W).toBe(flushT)
    expect(partOf(job, '天地板').expr.H).toBe(flushT)
    expect(partOf(job, '棚板').expr.H).toBe(flushT)
    expect(partOf(job, '背板').expr.D).toBe(`{t:${boardOf(job, 'ラワン', 4)[0].id}}`)
    const thicker = { ...job, flushes: [{ ...job.flushes[0], core: 18 }] }
    expect(finishedOf(thicker, '天地板')!.H).toBe(28)
    expect(finishedOf(thicker, '天地板')!.W).toBe(844)
  })

  it('追加するたびに別の仕事（id が新しい）', () => {
    const a = sampleFromTemplate(defaultTemplate(), NOW)
    const b = sampleFromTemplate(defaultTemplate(), NOW)
    expect(a.id).not.toBe(b.id)
    expect(a.parts[0].id).not.toBe(b.parts[0].id)
  })

  it('最後に使った設定（切り代・調整寸法・材料・フラッシュ・切り方）をそのまま使う', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(updateSettings(a, { allowance: 5, kerf: 4, trim: 8, cutMode: 'horizontal' }))
    a = must(addNige(a, 'ほぞ', 15, 'hozo-15'))
    a = must(addBoard(a, newBoard({ material: 'シナランバー', thickness: 18 })))
    a = must(addBoard(a, newBoard({ material: 'タモ', thickness: 20 })))
    const lauan25 = a.boards.find((b) => b.thickness === 2.5)!
    a = must(addFlush(a, { name: 'フラッシュ21', core: 16, faces: [{ boardId: lauan25.id, count: 2 }] }))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.settings).toMatchObject({ allowance: 5, kerf: 4, trim: 8, cutMode: 'horizontal' })
    expect(job.settings.nige.map((n) => [n.name, n.value])).toEqual([
      ['逃げ', 0.5],
      ['逃げ', 1],
      ['ほぞ', 15],
    ])
    expect(boardOf(job, 'シナランバー', 18)).toHaveLength(1)
    expect(boardOf(job, 'タモ', 20)).toHaveLength(1)
    expect(job.boards).toHaveLength(6)
    expect(partOf(job, '側板').boardId).toBeNull()
    expect(job.flushes.map((f) => f.name)).toEqual(['フラッシュ21', 'フラッシュ25'])
    expect(dimOf(job, '側板').cutSize).toMatchObject({ H: 1805, D: 405 })
  })

  it('画面と同じ流れ：仕事で設定を変えたあとの見本に、その設定が入っている', () => {
    const job = createJob('A', undefined, NOW, 'job-a')
    let s: StoreState = initialState({ status: 'ok', data: { jobs: [job], currentJobId: job.id } })
    const run = (op: JobOp) => {
      const { action } = applyOp(s, job.id, op, NOW.toISOString())
      if (action) s = storeReducer(s, action)
    }
    run((j) => updateSettings(j, { allowance: 7 }))
    run((j) => addNige(j, '逃げ', 2, 'nige-2'))
    run((j) => addBoard(j, newBoard({ material: 'ポリ合板', thickness: 2.5 })))
    const sample = sampleFromTemplate(s.template, NOW)
    expect(sample.settings.allowance).toBe(7)
    expect(sample.settings.nige.map((n) => n.value)).toEqual([0.5, 1, 2])
    expect(boardOf(sample, 'ポリ合板', 2.5)).toHaveLength(1)
  })

  it('フラッシュ25 がすでにあれば、それを使う（中身が違っても重ねて作らない）', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    const mel = a.boards.find((b) => b.material === 'メラミン')!
    a = must(addFlush(a, { name: 'フラッシュ25', core: 21, faces: [{ boardId: mel.id, count: 2 }] }))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.flushes).toHaveLength(1)
    // ひな形のフラッシュ25 の重ね切りの設定はそのまま（このフラッシュは表面材1種類なのでオフ）
    expect(job.flushes[0].stack).toBeUndefined()
    expect(finishedOf(job, '天地板')!.H).toBe(23)
    expect(finishedOf(job, '天地板')!.W).toBe(854)
    expect(computeDimensions(job).errors).toEqual([])
    expect(boardOf(job, 'メラミン', 1)[0].sizeKind).toBe('saburoku')
  })

  it('ひな形にある重ね切りオフのフラッシュ25（メラミン1×2・ラワン4×2）は、オフのまま使う（オンならオン）', () => {
    const base = createJob('A', undefined, NOW, 'job-a')
    const mel = base.boards.find((b) => b.material === 'メラミン')!
    const lauan = base.boards.find((b) => b.material === 'ラワン' && b.thickness === 4)!
    const faces = [
      { boardId: mel.id, count: 2 },
      { boardId: lauan.id, count: 2 },
    ]
    const off = must(addFlush(base, { name: 'フラッシュ25', core: 15, faces }))
    expect(off.flushes[0].stack).toBeUndefined()
    expect(sampleFromTemplate(templateOf(off), NOW).flushes[0].stack).toBeUndefined()
    const on = must(addFlush(base, { name: 'フラッシュ25', core: 15, faces, stack: true }))
    expect(sampleFromTemplate(templateOf(on), NOW).flushes[0].stack).toBe(true)
  })

  it('メラミン1・ラワン4 を消したひな形：フラッシュ25 のために足す', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    const ids = a.boards.filter((b) => b.thickness === 1 || b.thickness === 4).map((b) => b.id)
    a = must(removeBoards(a, ids))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(boardOf(job, 'メラミン', 1)).toHaveLength(1)
    expect(boardOf(job, 'ラワン', 4)).toHaveLength(1)
    expect(flushThickness(job.flushes[0], job.boards)).toBe(25)
    expect(computeDimensions(job).errors).toEqual([])
  })

  it('逃げ1 を消して逃げ2 だけのひな形：逃げ1 が足され、棚板の仕上がり W が 849', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(removeNiges(a, ['nige-0.5', 'nige-1']))
    a = must(addNige(a, '逃げ', 2, 'nige-2'))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.settings.nige.map((n) => n.value)).toEqual([2, 1])
    expect(finishedOf(job, '棚板')!.W).toBe(849)
  })

  it('寸法 1 の逃げが別の id でも、その逃げを使う', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(removeNiges(a, ['nige-1']))
    a = must(addNige(a, '逃げ', 1, 'nige-mine'))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.settings.nige.map((n) => n.id)).toEqual(['nige-0.5', 'nige-mine'])
    expect(partOf(job, '棚板').expr.W).toBe('天地板.W - {n:nige-mine}')
  })

  it('寸法 1 でも名前が違う調整寸法（ほぞ1）は使わず、逃げ1 を足す', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(removeNiges(a, ['nige-1']))
    a = must(addNige(a, 'ほぞ', 1, 'hozo-1'))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.settings.nige.map((n) => [n.name, n.value])).toEqual([
      ['逃げ', 0.5],
      ['ほぞ', 1],
      ['逃げ', 1],
    ])
    expect(partOf(job, '棚板').expr.W).not.toContain('hozo-1')
    expect(finishedOf(job, '棚板')!.W).toBe(849)
  })

  it('シナランバー・シナベニヤは足さない', () => {
    const job = sampleFromTemplate(defaultTemplate(), NOW)
    expect(job.boards.some((b) => b.material.startsWith('シナ'))).toBe(false)
  })

  it('ひな形を変えない', () => {
    const t = defaultTemplate()
    const before = JSON.stringify(t)
    sampleFromTemplate(t, NOW)
    expect(JSON.stringify(t)).toBe(before)
  })
})

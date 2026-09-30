import { describe, expect, it } from 'vitest'
import { orderedBoards } from '../engine/boards'
import { defaultBoards } from '../engine/defaults'
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
  updateSettings,
  type JobOp,
  type OpResult,
} from './jobs'
import { applyOp, initialState, storeReducer, type StoreState } from './reducer'
import { SAMPLE_NAME, sampleJob } from './sample'

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

describe('sampleJob（見本は初期値の設定から作る。フラッシュ25 と ラワン4 だけ）', () => {
  it('初期値の設定から：材料は最初からある材料＋芯材15（木取りしない）・フラッシュ25・逃げ0.5・1、寸法と木取りは見本の表どおり', () => {
    const job = sampleJob(NOW)
    expect(job.name).toBe(SAMPLE_NAME)
    // 芯材15（木取りしない。第2.5版）は見本で足した材料なので上に並ぶ
    expect(orderedBoards(job).map(boardLabel)).toEqual(['芯材 15mm', ...defaultBoards(() => 'x').map(boardLabel)])
    expect(boardOf(job, '芯材', 15)[0].noCut).toBe(true)
    // 見本で使う材料は 3×6、使わない材料は 4×8 のまま
    for (const [m, t] of [['メラミン', 1], ['ラワン', 4]] as const) {
      expect(boardOf(job, m, t)[0]).toMatchObject({ sizeKind: 'saburoku', width: 910, length: 1820 })
    }
    expect(boardOf(job, 'ラワン', 2.5)[0].sizeKind).toBe('shihachi')
    expect(job.settings.nige.map((n) => n.value)).toEqual([0.5, 1])
    expect(job.flushes.map((f) => [f.name, 'core' in f, flushThickness(f, job.boards)])).toEqual([['フラッシュ25', false, 25]])

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

    // 見本は仕事の重ね切りがオン（第2.6版。createJob の 'on'。フラッシュ25 に stack は付けない）：組 5枚・ラワン 4 のふつうの1枚は背板の1枚
    expect(job.stacking).toBe('on')
    expect(job.flushes[0].stack).toBeUndefined()
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
    }
    // 重ね切りをオフにすると第1.7版の見本（S-14）の値
    const off: Job = { ...job, stacking: 'off' }
    const r = packJob(off, computeDimensions(off))
    expect(r.materials.map((m) => [boardLabel(m), m.sheetCount])).toEqual([
      ['メラミン 1mm', 5],
      ['ラワン 4mm', 6],
    ])
    expect(r.materials.map((m) => Math.round(m.yieldRate * 1000) / 10)).toEqual([85.2, 87.3])
  })

  it('厚みは式の厚みで書く：材料・フラッシュの厚みを変えると寸法がついてくる', () => {
    const job = sampleJob(NOW)
    const flushT = `{t:${job.flushes[0].id}}`
    expect(partOf(job, '側板').expr.W).toBe(flushT)
    expect(partOf(job, '天地板').expr.H).toBe(flushT)
    expect(partOf(job, '棚板').expr.H).toBe(flushT)
    expect(partOf(job, '背板').expr.D).toBe(`{t:${boardOf(job, 'ラワン', 4)[0].id}}`)
    const thicker = { ...job, boards: job.boards.map((b) => (b.material === '芯材' ? { ...b, thickness: 18 } : b)) }
    expect(finishedOf(thicker, '天地板')!.H).toBe(28)
    expect(finishedOf(thicker, '天地板')!.W).toBe(844)
  })

  it('追加するたびに別の仕事（id が新しい）', () => {
    const a = sampleJob(NOW)
    const b = sampleJob(NOW)
    expect(a.id).not.toBe(b.id)
    expect(a.parts[0].id).not.toBe(b.parts[0].id)
  })

  it('設定を変えた仕事があっても、見本はいつも初期値の設定から作る（第2.5.1版）', () => {
    const job = createJob('A', NOW, 'job-a')
    let s: StoreState = initialState({ status: 'ok', data: { jobs: [job], currentJobId: job.id } })
    const run = (op: JobOp) => {
      const { action } = applyOp(s, job.id, op, NOW.toISOString())
      if (action) s = storeReducer(s, action)
    }
    run((j) => updateSettings(j, { allowance: 7, kerf: 4, trim: 8, cutMode: 'horizontal' }))
    run((j) => addNige(j, 'ほぞ', 15, 'hozo-15'))
    run((j) => removeNiges(j, ['nige-1']))
    run((j) => addBoard(j, newBoard({ material: 'タモ', thickness: 20 })))
    run((j) => removeBoards(j, j.boards.filter((b) => b.material === 'メラミン').map((b) => b.id)))
    const core16 = newBoard({ material: '芯材', thickness: 16, noCut: true })
    run((j) => addBoard(j, core16))
    run((j) => addFlush(j, { name: 'フラッシュ25', faces: [{ boardId: core16.id, count: 1 }] }))
    const sample = sampleJob(NOW)
    expect(sample.settings).toMatchObject({ allowance: 10, kerf: 3, trim: 5, cutMode: 'vertical' })
    expect(sample.settings.nige.map((n) => [n.name, n.value])).toEqual([
      ['逃げ', 0.5],
      ['逃げ', 1],
    ])
    expect(orderedBoards(sample).map(boardLabel)).toEqual(['芯材 15mm', ...defaultBoards(() => 'x').map(boardLabel)])
    expect(sample.flushes.map((f) => [f.name, flushThickness(f, sample.boards), f.stack])).toEqual([['フラッシュ25', 25, undefined]])
    expect(partOf(sample, '棚板').expr.W).toBe('天地板.W - {n:nige-1}')
  })

  it('シナランバー・シナベニヤは足さない（最初から入っている材料のほかに足すのは 芯材15 だけ）', () => {
    const job = sampleJob(NOW)
    expect(job.boards.some((b) => b.material === 'シナランバー' || b.material === 'シナベニヤ')).toBe(false)
    expect(job.boards.filter((b) => b.builtIn !== true).map((b) => b.material)).toEqual(['芯材'])
  })
})

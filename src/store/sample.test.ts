import { describe, expect, it } from 'vitest'
import { orderedBoards } from '../engine/boards'
import { computeDimensions } from '../engine/dimensions'
import { packJob } from '../engine/packing'
import type { Job } from '../engine/types'
import { addBoard, addNige, boardLabel, createJob, newBoard, removeNige, updateSettings, type OpResult } from './jobs'
import { SAMPLE_JOB_ID, sampleFromTemplate } from './sample'
import { defaultTemplate, templateOf } from './template'

const NOW = new Date('2026-09-26T10:00:00.000Z')

function must(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

const finishedOf = (job: Job, name: string) => computeDimensions(job).parts.find((p) => p.name === name)!.finished

describe('sampleFromTemplate（見本をひな形から作る）', () => {
  it('初期値のひな形から：材料6つ（シナランバー 18・シナベニヤ 4 が上）・逃げ0.5・1、結果は見本の表どおり', () => {
    const job = sampleFromTemplate(defaultTemplate(), NOW)
    expect(job.id).toBe(SAMPLE_JOB_ID)
    expect(job.name).toBe('本棚 W900')
    expect(job.boards).toHaveLength(6)
    expect(orderedBoards(job).map(boardLabel).slice(0, 2)).toEqual(['シナランバー 18mm', 'シナベニヤ 4mm'])
    const lumber = job.boards.find((b) => b.material === 'シナランバー')!
    expect(lumber).toMatchObject({ sizeKind: 'saburoku', width: 910, length: 1820 })
    expect(job.settings.nige.map((n) => n.value)).toEqual([0.5, 1])

    expect(finishedOf(job, '天地板')).toEqual({ W: 864, H: 18, D: 400 })
    expect(finishedOf(job, '棚板')).toEqual({ W: 863, H: 18, D: 380 })
    const r = packJob(job, computeDimensions(job))
    expect(r.materials.map((m) => [boardLabel(m), m.sheetCount])).toEqual([
      ['シナランバー 18mm', 3],
      ['シナベニヤ 4mm', 1],
    ])
    expect(computeDimensions(job).errors).toEqual([])
  })

  it('シナランバー 18 と切り代 5 が入ったひな形：材料が重ならず、部材がその材料を使い、切り代 5 で計算される', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(updateSettings(a, { allowance: 5 }))
    a = must(addBoard(a, newBoard({ material: 'シナランバー', thickness: 18 })))
    const job = sampleFromTemplate(templateOf(a), NOW)
    const lumbers = job.boards.filter((b) => b.material === 'シナランバー')
    expect(lumbers).toHaveLength(1)
    expect(lumbers[0].sizeKind).toBe('saburoku')
    expect(job.boards).toHaveLength(6)
    expect(job.parts.find((p) => p.name === '側板')!.boardId).toBe(lumbers[0].id)
    expect(job.settings.allowance).toBe(5)
    const side = computeDimensions(job).parts.find((p) => p.name === '側板')!
    expect(side.cutSize).toMatchObject({ H: 1805, D: 405 })
  })

  it('逃げ1 を消して逃げ2 だけのひな形：逃げ1 が足され、棚板の仕上がり W が 863', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(removeNige(a, 'nige-0.5'))
    a = must(removeNige(a, 'nige-1'))
    a = must(addNige(a, 2, 'nige-2'))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.settings.nige.map((n) => n.value)).toEqual([2, 1])
    expect(finishedOf(job, '棚板')!.W).toBe(863)
  })

  it('寸法 1 の逃げが別の id でも、その逃げを使う', () => {
    let a = createJob('A', undefined, NOW, 'job-a')
    a = must(removeNige(a, 'nige-1'))
    a = must(addNige(a, 1, 'nige-mine'))
    const job = sampleFromTemplate(templateOf(a), NOW)
    expect(job.settings.nige.map((n) => n.id)).toEqual(['nige-0.5', 'nige-mine'])
    expect(job.parts.find((p) => p.name === '棚板')!.expr.W).toBe('天地板.W - {n:nige-mine}')
  })

  it('ひな形を変えない', () => {
    const t = defaultTemplate()
    const before = JSON.stringify(t)
    sampleFromTemplate(t, NOW)
    expect(JSON.stringify(t)).toBe(before)
  })
})

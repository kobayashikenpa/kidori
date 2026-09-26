import { describe, expect, it } from 'vitest'
import { orderedBoards } from '../engine/boards'
import type { Job } from '../engine/types'
import { addBoard, addNige, boardLabel, createJob, newBoard, updateBoard, updateNige, updateSettings, type OpResult } from './jobs'
import { defaultTemplate, sameTemplate, templateOf } from './template'

const NOW = new Date('2026-09-26T10:00:00.000Z')

function must(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

describe('defaultTemplate（初めて使うときの設定）', () => {
  it('刃厚3・端切り5・切り代10・縦切り優先・逃げ0.5と1、材料 メラミン1・ラワン2.5・4・5.5', () => {
    const t = defaultTemplate()
    expect(t.settings).toEqual({
      kerf: 3,
      trim: 5,
      allowance: 10,
      cutMode: 'vertical',
      nige: [
        { id: 'nige-0.5', name: '逃げ', value: 0.5 },
        { id: 'nige-1', name: '逃げ', value: 1 },
      ],
    })
    expect(t.materials).toEqual([
      { material: 'メラミン', thickness: 1, builtIn: true },
      { material: 'ラワン', thickness: 2.5, builtIn: true },
      { material: 'ラワン', thickness: 4, builtIn: true },
      { material: 'ラワン', thickness: 5.5, builtIn: true },
    ])
    expect(defaultTemplate()).not.toBe(t)
    expect(defaultTemplate().settings.nige).not.toBe(t.settings.nige)
  })

  it('ひな形を渡さずに作った仕事は初期値で、材料は 4×8', () => {
    const job = createJob('箱', undefined, NOW, 'job-1')
    expect(templateOf(job)).toEqual(defaultTemplate())
    expect(job.boards.every((b) => b.sizeKind === 'shihachi' && b.width === 1220 && b.length === 2440 && b.grain === 'long')).toBe(true)
  })
})

describe('templateOf と createJob（設定の引き継ぎ）', () => {
  /** 切り代5・逃げ2 を足し・シナ18（3×6）を足した仕事 */
  function changedJob(): Job {
    let job = createJob('A', undefined, NOW, 'job-a')
    job = must(updateSettings(job, { allowance: 5 }))
    job = must(addNige(job, '逃げ', 2, 'nige-x'))
    job = must(addBoard(job, newBoard({ material: 'シナ', thickness: 18, sizeKind: 'saburoku' })))
    return job
  }

  it('写した仕事は 切り代5・逃げ0.5・1・2・材料5つ（シナ18 は 4×8、id は新しい）で、並び順も同じ', () => {
    const a = changedJob()
    const b = createJob('B', templateOf(a), NOW, 'job-b')
    expect(b.settings.allowance).toBe(5)
    expect(b.settings.nige).toEqual(a.settings.nige)
    expect(b.settings.nige.map((n) => n.value)).toEqual([0.5, 1, 2])
    expect(b.boards).toHaveLength(5)
    const shina = b.boards.find((x) => x.material === 'シナ')!
    expect(shina).toMatchObject({ thickness: 18, sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
    const aIds = new Set(a.boards.map((x) => x.id))
    expect(b.boards.some((x) => aIds.has(x.id))).toBe(false)
    expect(orderedBoards(b).map(boardLabel)).toEqual(orderedBoards(a).map(boardLabel))
    expect(orderedBoards(b)[0].material).toBe('シナ')
  })

  it('作った仕事の設定を変えても、ひな形と元の仕事は変わらない', () => {
    const a = changedJob()
    const t = templateOf(a)
    const b = createJob('B', t, NOW, 'job-b')
    b.settings.nige[0].value = 9
    b.settings.kerf = 7
    const b2 = must(updateSettings(b, { allowance: 8 }))
    expect(b2.settings.allowance).toBe(8)
    expect(t.settings.allowance).toBe(5)
    expect(t.settings.kerf).toBe(3)
    expect(t.settings.nige[0].value).toBe(0.5)
    expect(a.settings.nige[0].value).toBe(0.5)
    expect(a.settings.allowance).toBe(5)
  })

  it('ひな形を写した後に元の仕事を変えても、ひな形は変わらない（深いコピー）', () => {
    const a = changedJob()
    const t = templateOf(a)
    a.settings.nige[0].value = 9
    a.boards[0].material = 'かわった'
    expect(t.settings.nige[0].value).toBe(0.5)
    expect(t.materials[0].material).toBe('メラミン')
  })

  it('材料のサイズだけ違う2つの仕事のひな形は同じ', () => {
    const a = changedJob()
    const shina = a.boards.find((x) => x.material === 'シナ')!
    const b = must(updateBoard(a, shina.id, { sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' }))
    expect(sameTemplate(templateOf(a), templateOf(b))).toBe(true)
    expect(sameTemplate(templateOf(a), templateOf(must(updateSettings(a, { kerf: 2 }))))).toBe(false)
  })

  it('調整寸法の名前だけ変えてもひな形は変わり、写した仕事に名前が引き継がれる', () => {
    const a = changedJob()
    const b = must(updateNige(a, 'nige-x', 'ほぞ', 2))
    expect(sameTemplate(templateOf(a), templateOf(b))).toBe(false)
    const c = createJob('C', templateOf(b), NOW, 'job-c')
    expect(c.settings.nige.at(-1)).toEqual({ id: 'nige-x', name: 'ほぞ', value: 2 })
  })
})

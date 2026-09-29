// E-67：以前のフラッシュの芯材（core）を「芯材◯（木取りしない）」の材料と中身の1行に移す
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { CORE_15_ID, LAUAN_4_ID, MELAMINE_1_ID, SAMPLE_FLUSH_ID, sampleGroupJob } from '../fixtures/flush'
import { legacySampleFlushJob } from '../fixtures/legacyFlush'
import { flushThickness } from '../flush'
import { packJob } from '../packing'
import type { Board } from '../types'
import { migrateFlushCores, migrateFlushSpecCores } from './flushCore'

const counter = () => {
  let n = 0
  return () => `board-new-${++n}`
}

describe('migrateFlushCores（仕事）', () => {
  it('core 15 の以前の見本 → 材料の最後に芯材15（木取りしない・4×8）、中身の先頭に ×1、form・autoName', () => {
    const job = legacySampleFlushJob(true)
    const r = migrateFlushCores(job.boards, job.flushes, counter())
    expect(r.boards.length).toBe(job.boards.length + 1)
    expect(r.boards.slice(0, -1)).toEqual(job.boards)
    expect(r.boards.at(-1)).toEqual({
      id: 'board-new-1',
      material: '芯材',
      thickness: 15,
      sizeKind: 'shihachi',
      width: 1220,
      length: 2440,
      grain: 'long',
      noCut: true,
    })
    expect(r.flushes).toEqual([
      {
        id: SAMPLE_FLUSH_ID,
        name: 'フラッシュ25',
        faces: [
          { boardId: 'board-new-1', count: 1 },
          { boardId: MELAMINE_1_ID, count: 2 },
          { boardId: LAUAN_4_ID, count: 2 },
        ],
        stack: true,
        form: 'flush',
        autoName: true,
      },
    ])
    expect('core' in r.flushes[0]).toBe(false)
    expect(flushThickness(r.flushes[0], r.boards)).toBe(25)
  })

  it('移したあとは第2.5版の見本と同じ形で、寸法・木取りも以前の値（重ね切りオン・オフ）', () => {
    const pct = (r: number) => Math.round(r * 1000) / 10
    for (const stack of [true, false]) {
      const before = legacySampleFlushJob(stack)
      const r = migrateFlushCores(before.boards, before.flushes, () => CORE_15_ID)
      const after = { ...before, ...r }
      expect(after).toEqual(sampleGroupJob(stack))
      // フラッシュ25 の部材の厚み（側板 W・天地板と棚板 H）は 25 のまま
      const dims = computeDimensions(after)
      expect(dims.parts.find((p) => p.partId === 'part-gawa')?.finished?.W).toBe(25)
      if (stack) expect(pct(packJob(after, dims).totalYieldRate)).toBe(86.4)
    }
  })

  it('core 15 のフラッシュが2つでも芯材15 は1つ。core 12 には別の芯材12', () => {
    const job = legacySampleFlushJob()
    const f = job.flushes[0]
    const flushes = [f, { ...f, id: 'f2', name: '本棚用' }, { ...f, id: 'f3', name: 'フラッシュ22', core: 12 }]
    const r = migrateFlushCores(job.boards, flushes, counter())
    expect(r.boards.slice(job.boards.length).map((b) => [b.id, b.material, b.thickness, b.noCut])).toEqual([
      ['board-new-1', '芯材', 15, true],
      ['board-new-2', '芯材', 12, true],
    ])
    expect(r.flushes.map((x) => x.faces[0])).toEqual([
      { boardId: 'board-new-1', count: 1 },
      { boardId: 'board-new-1', count: 1 },
      { boardId: 'board-new-2', count: 1 },
    ])
    // 手で付けた名前（本棚用）は autoName なし
    expect(r.flushes.map((x) => x.autoName)).toEqual([true, undefined, true])
    expect(r.flushes.map((x) => x.form)).toEqual(['flush', 'flush', 'flush'])
  })

  it('芯材15（木取りしない）がすでにあれば足さずに使う', () => {
    const job = legacySampleFlushJob()
    const core: Board = { id: 'my-core', material: '芯材', thickness: 15, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', noCut: true }
    const boards = [...job.boards, core]
    const r = migrateFlushCores(boards, job.flushes, counter())
    expect(r.boards).toEqual(boards)
    expect(r.flushes[0].faces[0]).toEqual({ boardId: 'my-core', count: 1 })
  })

  it('木取りする 芯材15（全角・空白の違いも同じ材料）があれば noCut を付けて使う。もとの配列は変えない', () => {
    const job = legacySampleFlushJob()
    const core: Board = { id: 'my-core', material: ' 芯材 ', thickness: 15.0, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' }
    const boards = [core, ...job.boards]
    const r = migrateFlushCores(boards, job.flushes, counter())
    expect(r.boards.length).toBe(boards.length)
    expect(r.boards[0]).toEqual({ ...core, noCut: true })
    expect(core.noCut).toBeUndefined()
    expect(r.flushes[0].faces[0]).toEqual({ boardId: 'my-core', count: 1 })
  })

  it('core の無いフラッシュは変わらない（材料も足さない）', () => {
    const job = sampleGroupJob(true)
    const r = migrateFlushCores(job.boards, job.flushes, counter())
    expect(r.boards).toEqual(job.boards)
    expect(r.flushes).toEqual(job.flushes)
  })
})

describe('migrateFlushSpecCores（ひな形）', () => {
  it('芯材15（木取りしない）を材料の最後に足し、中身の先頭に ×1', () => {
    const materials = [
      { material: 'メラミン', thickness: 1, builtIn: true as const },
      { material: 'ラワン', thickness: 4, builtIn: true as const },
    ]
    const flushes = [
      {
        name: 'フラッシュ25',
        core: 15,
        faces: [
          { material: 'メラミン', thickness: 1, count: 2 },
          { material: 'ラワン', thickness: 4, count: 2 },
        ],
        stack: true as const,
      },
      { name: 'フラッシュ23', core: 15, faces: [{ material: 'ラワン', thickness: 4, count: 2 }] },
    ]
    const r = migrateFlushSpecCores(materials, flushes)
    expect(r.materials).toEqual([...materials, { material: '芯材', thickness: 15, noCut: true }])
    expect(r.flushes).toEqual([
      {
        name: 'フラッシュ25',
        faces: [
          { material: '芯材', thickness: 15, count: 1 },
          { material: 'メラミン', thickness: 1, count: 2 },
          { material: 'ラワン', thickness: 4, count: 2 },
        ],
        stack: true,
        form: 'flush',
        autoName: true,
      },
      {
        name: 'フラッシュ23',
        faces: [
          { material: '芯材', thickness: 15, count: 1 },
          { material: 'ラワン', thickness: 4, count: 2 },
        ],
        form: 'flush',
        autoName: true,
      },
    ])
  })

  it('木取りする芯材15 があれば noCut を付ける。core の無いものは変わらない', () => {
    const materials = [{ material: '芯材', thickness: 15 }]
    const plain = { name: 'ベタ20', faces: [{ material: 'ラワン', thickness: 18, count: 1 }], form: 'beta' as const }
    const r = migrateFlushSpecCores(materials, [plain, { name: '本棚用', core: 15, faces: [] }])
    expect(r.materials).toEqual([{ material: '芯材', thickness: 15, noCut: true }])
    expect(r.flushes).toEqual([plain, { name: '本棚用', faces: [{ material: '芯材', thickness: 15, count: 1 }], form: 'flush' }])
  })
})

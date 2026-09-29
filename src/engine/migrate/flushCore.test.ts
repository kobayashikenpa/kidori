// E-67：以前のフラッシュの芯材（core）を「芯材◯（木取りしない）」の材料と中身の1行に移す
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { CORE_15_ID, LAUAN_4_ID, MELAMINE_1_ID, SAMPLE_FLUSH_ID, flushPart, sampleGroupJob } from '../fixtures/flush'
import { legacySampleFlushJob } from '../fixtures/legacyFlush'
import { flushThickness } from '../flush'
import { packJob } from '../packing'
import type { Board } from '../types'
import { boardIdsInUse, migrateFlushCores } from './flushCore'

const none: ReadonlySet<string> = new Set()

const counter = () => {
  let n = 0
  return () => `board-new-${++n}`
}

describe('migrateFlushCores（仕事）', () => {
  it('core 15 の以前の見本 → 材料の最後に芯材15（木取りしない・4×8）、中身の先頭に ×1、form・autoName', () => {
    const job = legacySampleFlushJob(true)
    const r = migrateFlushCores(job.boards, job.flushes, counter(), none)
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
      const r = migrateFlushCores(before.boards, before.flushes, () => CORE_15_ID, none)
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
    const r = migrateFlushCores(job.boards, flushes, counter(), none)
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
    const r = migrateFlushCores(boards, job.flushes, counter(), none)
    expect(r.boards).toEqual(boards)
    expect(r.flushes[0].faces[0]).toEqual({ boardId: 'my-core', count: 1 })
  })

  it('木取りする 芯材15（全角・空白の違いも同じ材料）があれば noCut を付けて使う。もとの配列は変えない', () => {
    const job = legacySampleFlushJob()
    const core: Board = { id: 'my-core', material: ' 芯材 ', thickness: 15.0, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' }
    const boards = [core, ...job.boards]
    const r = migrateFlushCores(boards, job.flushes, counter(), none)
    expect(r.boards.length).toBe(boards.length)
    expect(r.boards[0]).toEqual({ ...core, noCut: true })
    expect(core.noCut).toBeUndefined()
    expect(r.flushes[0].faces[0]).toEqual({ boardId: 'my-core', count: 1 })
  })

  it('core の無いフラッシュは変わらない（材料も足さない）', () => {
    const job = sampleGroupJob(true)
    const r = migrateFlushCores(job.boards, job.flushes, counter(), none)
    expect(r.boards).toEqual(job.boards)
    expect(r.flushes).toEqual(job.flushes)
  })
})

describe('migrateFlushCores：使っている木取りする芯材は木取りしないにしない（仕様書 4：結果は変わらない）', () => {
  const sheet = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
  const cutCore: Board = { id: 'my-core', material: '芯材', thickness: 15, ...sheet }
  const san = flushPart({ id: 'part-san', name: '桟', boardId: 'my-core', expr: { W: '300', H: '600', D: '15' }, quantity: 2, grain: 'any' })

  it('木取りする芯材15 を部材（桟 W300 H600 D15 ×2）が使っていれば、別に「芯材（木取りしない）」15 を足し、桟の片は木取りされたまま', () => {
    for (const stack of [true, false]) {
      const legacy = legacySampleFlushJob(stack)
      const before = { ...legacy, boards: [...legacy.boards, cutCore], parts: [...legacy.parts, san] }
      const r = migrateFlushCores(before.boards, before.flushes, () => CORE_15_ID, boardIdsInUse(before))
      // 木取りする芯材15 はそのまま。木取りしない芯材は別の名前で材料の最後に
      expect(r.boards.slice(0, -1)).toEqual(before.boards)
      expect(r.boards.at(-1)).toEqual({
        id: CORE_15_ID,
        material: '芯材（木取りしない）',
        thickness: 15,
        sizeKind: 'shihachi',
        width: 1220,
        length: 2440,
        grain: 'long',
        noCut: true,
      })
      expect(r.flushes[0].faces[0]).toEqual({ boardId: CORE_15_ID, count: 1 })
      const after = { ...before, ...r }

      // 比べる相手：第2.5版の見本（芯材15 は木取りしない）に、木取りする芯材15 と桟を足したもの
      const ref0 = sampleGroupJob(stack)
      const ref = { ...ref0, boards: [...ref0.boards.filter((b) => b.id !== CORE_15_ID), cutCore, ref0.boards.find((b) => b.id === CORE_15_ID)!], parts: [...ref0.parts, san] }
      const dimsAfter = computeDimensions(after)
      const dimsRef = computeDimensions(ref)
      expect(dimsAfter).toEqual(dimsRef)
      const packAfter = packJob(after, dimsAfter)
      const packRef = packJob(ref, dimsRef)
      expect(packAfter.materials).toEqual(packRef.materials)
      expect(packAfter.totalYieldRate).toBe(packRef.totalYieldRate)
      expect(packAfter.materials.flatMap((m) => m.unplaced)).toEqual([])
      expect(packAfter.skipped).toEqual(packRef.skipped)

      // 桟の片（2枚）は芯材15 の板に入る
      const coreResult = packAfter.materials.find((m) => m.boardId === 'my-core')
      const san2 = coreResult?.sheets.flatMap((s) => s.placements).filter((x) => x.partId === 'part-san') ?? []
      expect(san2.length).toBe(2)
      // フラッシュ25 の分は第2.5版の見本と同じ
      const plain = packJob(sampleGroupJob(stack), computeDimensions(sampleGroupJob(stack)))
      expect(packAfter.materials.filter((m) => m.boardId !== 'my-core')).toEqual(plain.materials)
    }
  })

  it('ほかの材料グループの中身・手持ちの行で使っている芯材15 も、木取りしないにしない', () => {
    const legacy = legacySampleFlushJob()
    const other = { id: 'f-other', name: '本棚用', faces: [{ boardId: 'my-core', count: 1 }] }
    const r1 = migrateFlushCores([...legacy.boards, cutCore], [...legacy.flushes, other], counter(), none)
    expect(r1.boards.find((b) => b.id === 'my-core')?.noCut).toBeUndefined()
    expect(r1.boards.at(-1)).toMatchObject({ id: 'board-new-1', material: '芯材（木取りしない）', thickness: 15, noCut: true })

    const stocked: Board = { ...cutCore, stock: [{ id: 's1', sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 2 }] }
    const r2 = migrateFlushCores([...legacy.boards, stocked], legacy.flushes, counter(), none)
    expect(r2.boards.find((b) => b.id === 'my-core')).toEqual(stocked)
    expect(r2.flushes[0].faces[0]).toEqual({ boardId: 'board-new-1', count: 1 })
  })

  it('使っている芯材15 があっても、芯材（木取りしない）15 がすでにあればそれを使う。芯材のフラッシュが2つでも足すのは1つ', () => {
    const legacy = legacySampleFlushJob()
    const f = legacy.flushes[0]
    const flushes = [f, { ...f, id: 'f2', name: 'フラッシュ25-2' }]
    const r = migrateFlushCores([...legacy.boards, cutCore], flushes, counter(), new Set(['my-core']))
    expect(r.boards.length).toBe(legacy.boards.length + 2)
    expect(r.flushes.map((x) => x.faces[0].boardId)).toEqual(['board-new-1', 'board-new-1'])

    const noCutCore: Board = { ...cutCore, id: 'nc', material: '芯材（木取りしない）', noCut: true }
    const r2 = migrateFlushCores([...legacy.boards, cutCore, noCutCore], [f], counter(), new Set(['my-core']))
    expect(r2.boards).toEqual([...legacy.boards, cutCore, noCutCore])
    expect(r2.flushes[0].faces[0]).toEqual({ boardId: 'nc', count: 1 })
  })

  it('boardIdsInUse：部材の材料・固定した1枚（重ね切りのもう1つも）・組の設定の材料。読めない値は飛ばす', () => {
    const ids = boardIdsInUse({
      parts: [{ boardId: 'a' }, { boardId: null }, 'x', null],
      frozenSheets: [{ boardId: 'b', stackWith: { boardId: 'c' } }, 3],
      stackSheets: [{ boardIds: ['d', 'e'] }, { boardIds: 'z' }],
    })
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(boardIdsInUse({ parts: 'bad', frozenSheets: undefined, stackSheets: null }).size).toBe(0)
  })
})

describe('migrateFlushCores：自動の名前（autoName）は、名前が移したあとの厚みの自動の名前のときだけ', () => {
  it('厚み 25 の「フラッシュ30」は autoName なしで名前もそのまま。「フラッシュ25」「フラッシュ25-2」は autoName', () => {
    const legacy = legacySampleFlushJob()
    const f = legacy.flushes[0]
    const flushes = [
      { ...f, name: 'フラッシュ30' },
      { ...f, id: 'f2', name: 'フラッシュ25' },
      { ...f, id: 'f3', name: 'フラッシュ25-2' },
      { ...f, id: 'f4', name: 'フラッシュ2' },
    ]
    const r = migrateFlushCores(legacy.boards, flushes, counter(), none)
    expect(r.flushes.map((x) => [x.name, x.autoName])).toEqual([
      ['フラッシュ30', undefined],
      ['フラッシュ25', true],
      ['フラッシュ25-2', true],
      ['フラッシュ2', undefined],
    ])
  })
})

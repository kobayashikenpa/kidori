import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../engine/fixtures/bookshelf'
import { DEFAULT_SETTINGS, type Job } from '../engine/types'
import {
  addBoard,
  addPart,
  boardLabel,
  createJob,
  newBoard,
  newPart,
  partsUsingBoard,
  removeBoard,
  removePart,
  updateBoard,
  updatePart,
  updateSettings,
  type OpResult,
} from './jobs'

function unwrap(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

describe('createJob', () => {
  it('新しい仕事の設定は初期値で、板・部材はない', () => {
    const job = createJob('食器棚', new Date('2026-09-01T00:00:00Z'), 'job-1')
    expect(job.settings).toEqual(DEFAULT_SETTINGS)
    expect(job.settings).not.toBe(DEFAULT_SETTINGS)
    expect(job.boards).toEqual([])
    expect(job.parts).toEqual([])
    expect(job.name).toBe('食器棚')
    expect(job.createdAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('id を指定しなければ別々の id になる', () => {
    expect(createJob('a').id).not.toBe(createJob('a').id)
  })
})

describe('updateSettings', () => {
  it('設定の一部を変える', () => {
    const job = unwrap(updateSettings(bookshelfJob(), { kerf: 4, cutMode: 'auto' }))
    expect(job.settings).toEqual({ ...DEFAULT_SETTINGS, kerf: 4, cutMode: 'auto' })
  })
  it('負の数は断る', () => {
    expect(updateSettings(bookshelfJob(), { trim: -1 }).ok).toBe(false)
  })
})

describe('部材', () => {
  it('同じ名前の部材を足すとエラー', () => {
    const r = addPart(bookshelfJob(), newPart({ name: '側板' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('側板')
  })

  it('全角・半角の違いだけの名前も重複とみなす', () => {
    const job = unwrap(addPart(bookshelfJob(), newPart({ name: '棚板1' })))
    expect(addPart(job, newPart({ name: '棚板１' })).ok).toBe(false)
  })

  it('使えない記号を含む名前は断る', () => {
    expect(addPart(bookshelfJob(), newPart({ name: '天板.2' })).ok).toBe(false)
  })

  it('新しい名前なら足せて、末尾に並ぶ', () => {
    const job = unwrap(addPart(bookshelfJob(), newPart({ name: '  地板  ' })))
    expect(job.parts.map((p) => p.name)).toEqual(['全体', '側板', '天地板', '棚板', '背板', '地板'])
  })

  it('名前を変えると、ほかの部材の式の参照もつけ替える', () => {
    const job = unwrap(updatePart(bookshelfJob(), 'part-zentai', { name: '外寸' }))
    const tenchi = job.parts.find((p) => p.id === 'part-tenchiita')!
    expect(tenchi.expr.W).toBe('外寸.W - 側板.W * 2')
  })

  it('ほかの部材と同じ名前には変えられない', () => {
    expect(updatePart(bookshelfJob(), 'part-tanaita', { name: '側板' }).ok).toBe(false)
  })

  it('名前を変えずに中身を変える', () => {
    const job = unwrap(updatePart(bookshelfJob(), 'part-tanaita', { quantity: 5, clearance: { W: 2 } }))
    const tana = job.parts.find((p) => p.id === 'part-tanaita')!
    expect(tana.quantity).toBe(5)
    expect(tana.clearance).toEqual({ W: 2 })
  })

  it('名前と式を同時に変えると、新しい式の参照もつけ替わる', () => {
    const job = unwrap(
      updatePart(bookshelfJob(), 'part-zentai', { name: '外寸', expr: { W: '1000', H: '1800', D: '400' } }),
    )
    expect(job.parts[0].expr.W).toBe('1000')
    expect(job.parts[0].name).toBe('外寸')
  })

  it('枚数が負・小数なら断る', () => {
    expect(updatePart(bookshelfJob(), 'part-tanaita', { quantity: -1 }).ok).toBe(false)
    expect(updatePart(bookshelfJob(), 'part-tanaita', { quantity: 1.5 }).ok).toBe(false)
  })

  it('部材を消す', () => {
    const job = unwrap(removePart(bookshelfJob(), 'part-seita'))
    expect(job.parts.map((p) => p.name)).not.toContain('背板')
  })

  it('元の仕事は書き換えない', () => {
    const job = bookshelfJob()
    updatePart(job, 'part-zentai', { name: '外寸' })
    expect(job.parts[0].name).toBe('全体')
  })
})

describe('板', () => {
  it('見本でシナランバー18を使っている部材は 側板・天地板・棚板', () => {
    expect(partsUsingBoard(bookshelfJob(), LUMBER_18_ID)).toEqual(['側板', '天地板', '棚板'])
  })

  it('板を削除すると、使っていた部材の板が未設定になる', () => {
    const job = unwrap(removeBoard(bookshelfJob(), LUMBER_18_ID))
    expect(job.boards.map((b) => b.id)).toEqual([VENEER_4_ID])
    const unset = job.parts.filter((p) => p.boardId === null).map((p) => p.name)
    expect(unset).toEqual(['全体', '側板', '天地板', '棚板'])
    expect(job.parts.find((p) => p.name === '背板')!.boardId).toBe(VENEER_4_ID)
  })

  it('見本の板2つを新しい仕事に登録できる', () => {
    let job = createJob('本棚')
    job = unwrap(addBoard(job, newBoard({ material: 'シナランバー', thickness: 18 })))
    job = unwrap(addBoard(job, newBoard({ material: 'シナベニヤ', thickness: 4 })))
    expect(job.boards.map(boardLabel)).toEqual(['シナランバー 18mm', 'シナベニヤ 4mm'])
    expect(job.boards[0]).toMatchObject({ width: 910, length: 1820, grain: 'long' })
  })

  it('材料名＋厚みが同じ板は登録できない', () => {
    const r = addBoard(bookshelfJob(), newBoard({ material: ' シナランバー ', thickness: 18 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('シナランバー 18mm')
  })

  it('材料名が同じでも厚みが違えば登録できる', () => {
    expect(addBoard(bookshelfJob(), newBoard({ material: 'シナランバー', thickness: 21 })).ok).toBe(true)
  })

  it('材料名が空なら断る', () => {
    expect(addBoard(bookshelfJob(), newBoard({ material: '  ' })).ok).toBe(false)
  })

  it('シハチにすると寸法が 1220×2440、木目は長辺方向になる', () => {
    const job = unwrap(updateBoard(bookshelfJob(), LUMBER_18_ID, { sizeKind: 'shihachi', grain: 'short' }))
    expect(job.boards[0]).toMatchObject({ width: 1220, length: 2440, grain: 'long' })
  })

  it('自由入力は寸法と木目を選べ、短い方を短辺にする', () => {
    const job = unwrap(
      updateBoard(bookshelfJob(), LUMBER_18_ID, { sizeKind: 'custom', width: 2000, length: 1000, grain: 'short' }),
    )
    expect(job.boards[0]).toMatchObject({ width: 1000, length: 2000, grain: 'short' })
  })

  it('ほかの板と同じ材料名＋厚みには変えられない', () => {
    expect(updateBoard(bookshelfJob(), VENEER_4_ID, { material: 'シナランバー', thickness: 18 }).ok).toBe(false)
  })

  it('自分と同じ材料名＋厚みのまま変えるのはよい', () => {
    expect(updateBoard(bookshelfJob(), LUMBER_18_ID, { sizeKind: 'shihachi' }).ok).toBe(true)
  })
})

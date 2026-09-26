import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../defaults'
import { bookshelfJob } from './bookshelf'

describe('見本（本棚 W900）', () => {
  const job = bookshelfJob()

  it('部材が5つ、板が2つ', () => {
    expect(job.parts.map((p) => p.name)).toEqual(['全体', '側板', '天地板', '棚板', '背板'])
    expect(job.boards).toHaveLength(2)
  })

  it('部材名に重複がない', () => {
    const names = job.parts.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('設定は初期値', () => {
    expect(job.settings).toEqual(defaultSettings())
  })

  it('逃げは 逃げ0.5mm・逃げ1mm（初期の材料4つは入れない）', () => {
    expect(job.settings.nige).toEqual([
      { id: 'nige-0.5', value: 0.5 },
      { id: 'nige-1', value: 1 },
    ])
  })

  it('メモは空、加工のチェックはすべて外れている', () => {
    for (const p of job.parts) {
      expect(p.memo).toBe('')
      expect(p.checks).toEqual({ finished: false, cut: false })
    }
  })

  it('板はシナランバー18とシナベニヤ4（サブロク・木目は長辺方向）', () => {
    expect(job.boards.map((b) => [b.material, b.thickness, b.width, b.length, b.grain])).toEqual([
      ['シナランバー', 18, 910, 1820, 'long'],
      ['シナベニヤ', 4, 910, 1820, 'long'],
    ])
  })

  it('部材の板はすべて登録済みの板を指す（全体は板なし）', () => {
    const boardIds = new Set(job.boards.map((b) => b.id))
    for (const p of job.parts) {
      if (p.name === '全体') expect(p.boardId).toBeNull()
      else expect(boardIds.has(p.boardId ?? '')).toBe(true)
    }
  })

  it('呼ぶたびに別のオブジェクトを返す（テストどうしで書き換えが漏れない）', () => {
    const a = bookshelfJob()
    a.parts[0].expr.W = '1000'
    expect(bookshelfJob().parts[0].expr.W).toBe('900')
  })
})

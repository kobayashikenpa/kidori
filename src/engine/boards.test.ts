import { describe, expect, it } from 'vitest'
import { isBuiltInBoard, orderedBoards } from './boards'
import { defaultBoards } from './defaults'
import { bookshelfJob } from './fixtures/bookshelf'
import type { Board } from './types'

let n = 0
const newId = (prefix: string) => `${prefix}-${++n}`

function added(material: string, thickness: number, p: Partial<Board> = {}): Board {
  return { id: newId('board'), material, thickness, sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', ...p }
}

const names = (boards: Board[]) => boards.map((b) => `${b.material}${b.thickness}`)
const DEFAULT_NAMES = names(defaultBoards(() => ''))

/** 第1.1版までの最初からある4つ（メラミン1・ラワン2.5・4・5.5）。印（builtIn）なし・4×8 */
function oldFour(): Board[] {
  const sheet = { sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const
  return ([['メラミン', 1], ['ラワン', 2.5], ['ラワン', 4], ['ラワン', 5.5]] as const).map(([material, thickness]) => ({
    id: newId('board'),
    material,
    thickness,
    ...sheet,
  }))
}

describe('defaultBoards の印', () => {
  it('最初から入っている材料には builtIn: true が付く', () => {
    expect(defaultBoards(newId).every((b) => b.builtIn === true)).toBe(true)
  })
})

describe('orderedBoards（材料の並び順）', () => {
  it('新しい仕事に タモ18・タモ4 の順に足すと、タモ18・タモ4・最初からある材料（元の並び）', () => {
    const boards = [...defaultBoards(newId), added('タモ', 18), added('タモ', 4)]
    expect(names(orderedBoards({ boards }))).toEqual(['タモ18', 'タモ4', ...DEFAULT_NAMES])
  })

  it('足していなければ最初からある材料だけ（元の並び）', () => {
    const boards = defaultBoards(newId)
    expect(orderedBoards({ boards }).map((b) => b.id)).toEqual(boards.map((b) => b.id))
  })

  it('最初からある材料を1つ消しても、残りは下に並ぶ', () => {
    const boards = [...defaultBoards(newId).slice(1), added('タモ', 18)]
    expect(names(orderedBoards({ boards }))).toEqual(['タモ18', ...DEFAULT_NAMES.slice(1)])
  })

  it('最初からある材料の厚みを変えても、最初からある材料のまま（下に並ぶ）', () => {
    const boards = [...defaultBoards(newId), added('タモ', 18)]
    boards[1] = { ...boards[1], thickness: 2 }
    expect(names(orderedBoards({ boards }))).toEqual(['タモ18', 'メラミン1', 'ラワン2', ...DEFAULT_NAMES.slice(2)])
  })

  it('見本（シナランバー18・シナベニヤ4）は足した材料として元の並びのまま', () => {
    expect(names(orderedBoards(bookshelfJob()))).toEqual(['シナランバー18', 'シナベニヤ4'])
  })

  it('元の配列は並べ替えない（新しい配列を返す）', () => {
    const boards = [...defaultBoards(newId), added('シナ', 18)]
    const before = boards.map((b) => b.id)
    const out = orderedBoards({ boards })
    expect(boards.map((b) => b.id)).toEqual(before)
    expect(out).not.toBe(boards)
  })

  describe('印の無い以前のデータ（第1.1版で作った仕事）', () => {
    const legacy = oldFour

    it('第1.1版の最初からある4つと同じ材料は下に、ほかは保存の並びで上に（第2.5版で増えた シナ18 なども足した材料）', () => {
      const boards = [...legacy(), added('シナ', 18), added('シナ', 4)]
      expect(names(orderedBoards({ boards }))).toEqual(['シナ18', 'シナ4', 'メラミン1', 'ラワン2.5', 'ラワン4', 'ラワン5.5'])
    })

    it('材料名＋厚みだけで判定する：ラワン 4 のサイズを 3×6 にしても最初からある材料として下に並ぶ（第1.3版）', () => {
      const boards = [...legacy(), added('シナ', 18)]
      boards[2] = { ...boards[2], sizeKind: 'saburoku', width: 910, length: 1820 }
      expect(names(orderedBoards({ boards }))).toEqual(['シナ18', 'メラミン1', 'ラワン2.5', 'ラワン4', 'ラワン5.5'])
      expect(isBuiltInBoard(boards[2], { boards })).toBe(true)
    })

    it('自由入力・木目 短手方向にしても、材料名＋厚みが同じなら最初からある材料（前後の空白は無視）', () => {
      const boards = legacy()
      boards[1] = { ...boards[1], material: ' ラワン ', sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' }
      expect(isBuiltInBoard(boards[1], { boards })).toBe(true)
    })

    it('厚みが違えば（ラワン 3）足した材料', () => {
      const boards = legacy()
      boards[2] = { ...boards[2], thickness: 3 }
      expect(names(orderedBoards({ boards }))).toEqual(['ラワン3', 'メラミン1', 'ラワン2.5', 'ラワン5.5'])
    })

    it('isBuiltInBoard：印があればそれに従い、仕事に印のある材料が1つでもあれば、印の無い材料は足した材料', () => {
      const flagged = defaultBoards(newId)
      const copy = { ...flagged[3], id: 'x', builtIn: undefined }
      // 印のある仕事では、同じ内容でも印の無い材料は足した材料（消してから足し直した材料など）
      expect(isBuiltInBoard(copy, { boards: [flagged[0], copy] })).toBe(false)
      // 印がひとつも無い仕事（以前のデータ）では、内容が同じなら最初からある材料
      expect(isBuiltInBoard(copy, { boards: [copy] })).toBe(true)
    })
  })
})

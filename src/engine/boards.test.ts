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

describe('defaultBoards の印', () => {
  it('最初から入っている材料には builtIn: true が付く', () => {
    expect(defaultBoards(newId).map((b) => b.builtIn)).toEqual([true, true, true, true])
  })
})

describe('orderedBoards（材料の並び順）', () => {
  it('新しい仕事に シナ18・シナ4 の順に足すと、シナ18・シナ4・メラミン1・ラワン2.5・ラワン4・ラワン5.5', () => {
    const boards = [...defaultBoards(newId), added('シナ', 18), added('シナ', 4)]
    expect(names(orderedBoards({ boards }))).toEqual(['シナ18', 'シナ4', 'メラミン1', 'ラワン2.5', 'ラワン4', 'ラワン5.5'])
  })

  it('足していなければ最初からある材料だけ（元の並び）', () => {
    const boards = defaultBoards(newId)
    expect(orderedBoards({ boards }).map((b) => b.id)).toEqual(boards.map((b) => b.id))
  })

  it('最初からある材料を1つ消しても、残りは下に並ぶ', () => {
    const boards = [...defaultBoards(newId).slice(1), added('シナ', 18)]
    expect(names(orderedBoards({ boards }))).toEqual(['シナ18', 'ラワン2.5', 'ラワン4', 'ラワン5.5'])
  })

  it('最初からある材料の厚みを変えても、最初からある材料のまま（下に並ぶ）', () => {
    const boards = [...defaultBoards(newId), added('シナ', 18)]
    boards[2] = { ...boards[2], thickness: 3 }
    expect(names(orderedBoards({ boards }))).toEqual(['シナ18', 'メラミン1', 'ラワン2.5', 'ラワン3', 'ラワン5.5'])
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
    const legacy = () =>
      defaultBoards(newId).map((b) => {
        const c: Board = { ...b }
        delete c.builtIn
        return c
      })

    it('最初からある4つと同じ（材料名・厚み・大きさ・木目）材料は下に、ほかは保存の並びで上に', () => {
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
      const copy = { ...flagged[2], id: 'x', builtIn: undefined }
      // 印のある仕事では、同じ内容でも印の無い材料は足した材料（消してから足し直した材料など）
      expect(isBuiltInBoard(copy, { boards: [flagged[0], copy] })).toBe(false)
      // 印がひとつも無い仕事（以前のデータ）では、内容が同じなら最初からある材料
      expect(isBuiltInBoard(copy, { boards: [copy] })).toBe(true)
    })
  })
})

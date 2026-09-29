import { describe, expect, it } from 'vitest'
import { addMissingBuiltIns, builtInKey, isBuiltInBoard, orderedBoards } from './boards'
import { defaultBoards } from './defaults'
import { bookshelfJob } from './fixtures/bookshelf'
import { computeDimensions } from './dimensions'
import { sampleGroupJob } from './fixtures/flush'
import { packJob } from './packing'
import type { Board, Job } from './types'

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

describe('addMissingBuiltIns（最初から入っている材料を今ある仕事に足す。第2.5.1版）', () => {
  /** 寸法表と木取りの結果（比べる用） */
  const results = (job: Job) => {
    const dims = computeDimensions(job)
    return JSON.stringify([dims, packJob(job, dims)])
  }

  it('builtInKey は材料名の前後の空白・全角半角と、厚みの小数第1位をそろえる', () => {
    expect(builtInKey('ラワン', 9)).toBe(builtInKey(' ラワン ', 9.0))
    expect(builtInKey('ラワン', 2.5)).toBe(builtInKey('ラワン', 2.5000001))
    expect(builtInKey('ラワン', 2.5)).not.toBe(builtInKey('ラワン', 25))
  })

  it('以前の4つ（印あり）の見本に足りない21を足して25に。今ある材料・部材・寸法表・木取りの結果は同じ', () => {
    const job = sampleGroupJob(true)
    const before = results(job)
    const out = addMissingBuiltIns(job, newId)
    expect(out.boards).toHaveLength(job.boards.length + 21)
    // 今ある材料は1つも変わらない（同じ id・同じ中身・同じ前後の並び）
    const kept = out.boards.filter((b) => job.boards.some((x) => x.id === b.id))
    expect(kept).toEqual(job.boards)
    expect(out.parts).toBe(job.parts)
    expect(out.flushes).toBe(job.flushes)
    expect(out.stackSheets).toBe(job.stackSheets)
    expect(results(out)).toBe(before)
    // 足した材料は 4×8・印あり
    const fresh = out.boards.filter((b) => !job.boards.some((x) => x.id === b.id))
    expect(fresh.every((b) => b.builtIn === true && b.sizeKind === 'shihachi' && b.width === 1220 && b.length === 2440)).toBe(true)
    // 画面の並び：足した材料（芯材15）→ 最初から入っている材料（DEFAULT_MATERIALS の並び）
    expect(names(orderedBoards(out))).toEqual(['芯材15', ...DEFAULT_NAMES])
    // 元の仕事は変えない
    expect(job.boards).toHaveLength(5)
  })

  it('印の無い以前の仕事（第1.1版まで）は、最初からある4つに印を付けてから足す（並び順は変わらない）', () => {
    const boards = [added('タモ', 18), ...oldFour()]
    const job = { ...bookshelfJob(), boards }
    const out = addMissingBuiltIns(job, newId)
    expect(names(orderedBoards(out))).toEqual(['タモ18', ...DEFAULT_NAMES])
    // 今ある材料の前後は同じ。印は最初からある4つにだけ付く（ほかは変わらない）
    const kept = out.boards.filter((b) => boards.some((x) => x.id === b.id))
    expect(kept.map((b) => b.id)).toEqual(boards.map((b) => b.id))
    expect(kept[0]).toEqual(boards[0])
    expect(kept.slice(1)).toEqual(boards.slice(1).map((b) => ({ ...b, builtIn: true })))
  })

  it('本棚（シナランバー18・シナベニヤ4、印なし）には25を足し、寸法表・木取りは同じ', () => {
    const job = bookshelfJob()
    const out = addMissingBuiltIns(job, newId)
    expect(names(orderedBoards(out))).toEqual(['シナランバー18', 'シナベニヤ4', ...DEFAULT_NAMES])
    expect(out.boards.slice(0, 2)).toEqual(job.boards)
    expect(results(out)).toBe(results(job))
  })

  it('消した最初の材料（removedBuiltIns）は足さない', () => {
    const job = { ...sampleGroupJob(), removedBuiltIns: [builtInKey('ラワン', 9), builtInKey('ポリ', 4)] }
    const out = addMissingBuiltIns(job, newId)
    expect(out.boards).toHaveLength(job.boards.length + 19)
    expect(names(out.boards)).not.toContain('ラワン9')
    expect(names(out.boards)).not.toContain('ポリ4')
    expect(out.removedBuiltIns).toEqual(job.removedBuiltIns)
  })

  it('自分で足した同じ材料名＋厚みの材料（シナ 18・木取りしない芯材ではないもの）があれば足さない。空白・全角の違いも同じ', () => {
    const mine = added(' シナ ', 18)
    const job = { ...sampleGroupJob(), boards: [...sampleGroupJob().boards, mine] }
    const out = addMissingBuiltIns(job, newId)
    expect(out.boards.filter((b) => b.material.trim() === 'シナ' && b.thickness === 18)).toEqual([mine])
    expect(out.boards).toHaveLength(job.boards.length + 20)
  })

  it('全部あれば同じオブジェクトを返す', () => {
    const job = { ...bookshelfJob(), boards: defaultBoards(newId) }
    expect(addMissingBuiltIns(job, newId)).toBe(job)
    const removedAll = { ...sampleGroupJob(), removedBuiltIns: defaultBoards(newId).map((b) => builtInKey(b.material, b.thickness)) }
    expect(addMissingBuiltIns(removedAll, newId)).toBe(removedAll)
  })
})

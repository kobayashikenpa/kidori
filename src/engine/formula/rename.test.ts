import { describe, expect, it } from 'vitest'
import { bookshelfJob } from '../fixtures/bookshelf'
import { renamePart, renameRefsInExpr } from './rename'

describe('renameRefsInExpr（式の中の参照のつけ替え）', () => {
  it('旧名.X を 新名.X に書き換える（W・H・D すべて）', () => {
    expect(renameRefsInExpr('全体.W - 側板.W * 2 + 側板.H + 側板.D', '側板', '側板L')).toBe(
      '全体.W - 側板L.W * 2 + 側板L.H + 側板L.D',
    )
  })

  it('空白の有無など、ほかの部分はそのまま残す', () => {
    expect(renameRefsInExpr('(側板.W*2)+  10', '側板', '側')).toBe('(側.W*2)+  10')
  })

  it('名前の一部だけが同じ部材は書き換えない', () => {
    expect(renameRefsInExpr('側板2.W + 左側板.W + 側板.W', '側板', 'X')).toBe('側板2.W + 左側板.W + X.W')
  })

  it('読めない式でも、参照の部分だけ書き換える', () => {
    expect(renameRefsInExpr('側板.W + @', '側板', 'X')).toBe('X.W + @')
  })
})

describe('renameRefsInExpr：材料の厚み・逃げはつけ替えない', () => {
  it('部材名を変えても {n:nige-1} は変わらない', () => {
    expect(renameRefsInExpr('天地板.W - {n:nige-1}', '天地板', '天板')).toBe('天板.W - {n:nige-1}')
  })
  it('id が部材名と同じ形でも {…} の中は書き換えない', () => {
    expect(renameRefsInExpr('{t:側板.W} + 側板.W', '側板', 'X')).toBe('{t:側板.W} + X.W')
  })
})

describe('renamePart（部材名の変更と参照のつけ替え）', () => {
  it('見本で「全体」を「外形」に変えると、参照している式がすべて書き換わる', () => {
    const job = bookshelfJob()
    const r = renamePart(job.parts, 'part-zentai', '外形')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const byName = Object.fromEntries(r.parts.map((p) => [p.name, p.expr]))
    expect(byName['外形']).toEqual({ W: '900', H: '1800', D: '400' })
    expect(byName['側板']).toEqual({ W: '18', H: '外形.H', D: '外形.D' })
    expect(byName['天地板']).toEqual({ W: '外形.W - 側板.W * 2', H: '18', D: '外形.D' })
    expect(byName['棚板']).toEqual({ W: '天地板.W - {n:nige-1}', H: '18', D: '外形.D - 20' })
    expect(byName['背板']).toEqual({ W: '外形.W', H: '外形.H', D: '4' })
  })

  it('元の部材の一覧は書き換えない', () => {
    const job = bookshelfJob()
    renamePart(job.parts, 'part-zentai', '外形')
    expect(job.parts[0].name).toBe('全体')
    expect(job.parts[1].expr.H).toBe('全体.H')
  })

  it('使えない名前・ほかの部材と同じ名前には変えられない', () => {
    const parts = bookshelfJob().parts
    expect(renamePart(parts, 'part-zentai', '側板').ok).toBe(false)
    expect(renamePart(parts, 'part-zentai', '全 体').ok).toBe(false)
    expect(renamePart(parts, 'part-zentai', '全体.W').ok).toBe(false)
  })

  it('同じ名前のままなら何も変わらない', () => {
    const parts = bookshelfJob().parts
    const r = renamePart(parts, 'part-zentai', '全体')
    expect(r.ok && r.parts).toEqual(parts)
  })

  it('存在しない部材の id はエラー', () => {
    expect(renamePart(bookshelfJob().parts, 'nope', 'X').ok).toBe(false)
  })
})

describe('全角で書いた参照のつけ替え', () => {
  it('側板．Ｗ も書き換える（ほかの部分は入力したまま）', () => {
    expect(renameRefsInExpr('側板．Ｗ　＋　１０', '側板', '側')).toBe('側.W　＋　１０')
  })
})

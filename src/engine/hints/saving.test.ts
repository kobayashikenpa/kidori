import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { Job, Part, Settings } from '../types'
import { findSavingHints } from './saving'

function part(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
  return {
    boardId: LUMBER_18_ID,
    thicknessAxis: 'D',
    quantity: 1,
    grain: 'H',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
    ...p,
  }
}

/** シナランバー 18 だけの仕事に、W×1800×18（厚み D・木目 H）の部材を置く */
function jobWith(w: number, quantity: number, settings: Partial<Settings> = {}): Job {
  const job = bookshelfJob()
  job.settings = { ...job.settings, ...settings }
  job.boards = job.boards.filter((b) => b.id === LUMBER_18_ID)
  job.parts = [part({ id: 'p1', name: '側板', expr: { W: String(w), H: '1800', D: '18' }, quantity })]
  return job
}

describe('findSavingHints（材料を減らせるときのお知らせ）', () => {
  it('切り代10 で 4枚 → 切り代5 にすると 2枚。切り代0 は同じ内容なので出さない。端切り0 では減らない', () => {
    const job = jobWith(445, 4)
    const hints = findSavingHints(job)
    expect(hints).toHaveLength(1)
    expect(hints[0].change).toEqual({ kind: 'allowance', value: 5 })
    expect(hints[0].materials).toEqual([{ boardId: LUMBER_18_ID, label: 'シナランバー 18mm', from: 4, to: 2 }])
    expect(hints[0].message).toBe('切り代を 5mm にすると、シナランバー 18mm が 2 枚減ります（4枚 → 2枚）')
  })

  it('切り代0・W453 ×2枚 は 端切りを 0mm にすると 1枚減る（905 には 453+3+453=909 が入らず、910 には入る）', () => {
    const hints = findSavingHints(jobWith(453, 2, { allowance: 0 }))
    expect(hints.map((h) => h.message)).toEqual(['端切りを 0mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
    expect(hints[0].change).toEqual({ kind: 'trim', value: 0 })
  })

  it('1mm 足りないとき（W454：454+3+454=911 > 910）は端切り0 でも減らない', () => {
    expect(findSavingHints(jobWith(454, 2, { allowance: 0 }))).toEqual([])
  })

  it('見本（初期設定）ではお知らせが出ない', () => {
    expect(findSavingHints(bookshelfJob())).toEqual([])
  })

  it('計算の前後で仕事のデータが変わらない', () => {
    const job = jobWith(445, 4)
    const before = structuredClone(job)
    findSavingHints(job)
    expect(job).toEqual(before)
  })

  it('切り代が 0 なら切り代の候補はない。端切りが 0 なら端切りの候補はない', () => {
    expect(findSavingHints(jobWith(445, 4, { allowance: 0, trim: 0 }))).toEqual([])
  })

  it('部材ごとの切り代の上書きはそのまま（上書き10 の部材は、仕事の切り代を下げても減らない）', () => {
    const job = jobWith(445, 4)
    job.parts[0].allowance = 10
    expect(findSavingHints(job)).toEqual([])
  })

  it('試す端切りの値は引数で変えられる（端切り2 では 908 に 909 が入らず、端切り0 だけ出る）', () => {
    const hints = findSavingHints(jobWith(453, 2, { allowance: 0 }), { trimCandidates: [2, 0] })
    expect(hints.map((h) => h.change)).toEqual([{ kind: 'trim', value: 0 }])
  })

  it('端切り1 と 0 が同じ内容なら、小さく変えるほう（1）だけ出す', () => {
    const hints = findSavingHints(jobWith(453, 2, { allowance: 0 }), { trimCandidates: [0, 1] })
    expect(hints.map((h) => h.change)).toEqual([{ kind: 'trim', value: 1 }])
  })

  it('今の端切り以上の候補は試さない', () => {
    expect(findSavingHints(jobWith(453, 2, { allowance: 0, trim: 1 }), { trimCandidates: [5, 1] })).toEqual([])
  })

  it('複数の材料が減るときは、材料ごとの枚数を「、」でつなぐ', () => {
    const job = jobWith(445, 4)
    job.boards = bookshelfJob().boards
    job.parts.push(
      part({ id: 'p2', name: '背板', boardId: VENEER_4_ID, expr: { W: '445', H: '1800', D: '4' }, quantity: 2 }),
    )
    const hints = findSavingHints(job)
    expect(hints).toHaveLength(1)
    expect(hints[0].message).toBe(
      '切り代を 5mm にすると、シナランバー 18mm が 2 枚（4枚 → 2枚）、シナベニヤ 4mm が 1 枚（2枚 → 1枚）減ります',
    )
  })

  it('切り代5 と 切り代0 で減る材料が違えば両方出す（大きい値から）', () => {
    // シナランバー W445 ×4：切り代5 でも0 でも 4→2。シナベニヤ W449 ×2：切り代0 でだけ 2→1（449+3+449=901）
    const job = jobWith(445, 4)
    job.boards = bookshelfJob().boards
    job.parts.push(part({ id: 'p2', name: '背板', boardId: VENEER_4_ID, expr: { W: '449', H: '1800', D: '4' }, quantity: 2 }))
    const hints = findSavingHints(job)
    expect(hints.map((h) => h.change)).toEqual([
      { kind: 'allowance', value: 5 },
      { kind: 'allowance', value: 0 },
    ])
    expect(hints[1].materials.map((m) => [m.label, m.from, m.to])).toEqual([
      ['シナランバー 18mm', 4, 2],
      ['シナベニヤ 4mm', 2, 1],
    ])
  })

  it('並びは 切り代 → 端切り', () => {
    // 切り代5・W448 ×2：453+3+453=909。切り代0 なら 899 で入り、端切り0 なら 910 に入る
    const hints = findSavingHints(jobWith(448, 2, { allowance: 5 }))
    expect(hints.map((h) => h.change)).toEqual([
      { kind: 'allowance', value: 0 },
      { kind: 'trim', value: 0 },
    ])
  })
})

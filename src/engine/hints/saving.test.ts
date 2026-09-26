import { describe, expect, it } from 'vitest'
import { defaultBoards, defaultSettings } from '../defaults'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { Job, Part, Settings } from '../types'
import { findSavingHints, smallerSteps } from './saving'

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

describe('smallerSteps（試す値）', () => {
  it('今の値より小さい整数を 1 まで、最後に 0.5。0 は試さない', () => {
    expect(smallerSteps(10)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5])
    expect(smallerSteps(5)).toEqual([4, 3, 2, 1, 0.5])
    expect(smallerSteps(1)).toEqual([0.5])
  })

  it('今の値が小数なら切り捨てた値から', () => {
    expect(smallerSteps(7.5)).toEqual([7, 6, 5, 4, 3, 2, 1, 0.5])
    expect(smallerSteps(1.2)).toEqual([1, 0.5])
    expect(smallerSteps(0.8)).toEqual([0.5])
  })

  it('今の値が 0.5 以下なら何も試さない', () => {
    expect(smallerSteps(0.5)).toEqual([])
    expect(smallerSteps(0.3)).toEqual([])
    expect(smallerSteps(0)).toEqual([])
  })
})

describe('findSavingHints（材料を減らせるときのお知らせ）', () => {
  // サブロク（910×1820）・刃厚3・端切り5：妻手方向に使える幅は 905。
  // W の部材を2枚並べると (W + 切り代) × 2 + 刃厚3 が 905 以下なら1枚の板に入る

  it('切り代10・W445 ×4枚：9mm から順に試し、一番大きい 6mm を出す（451+3+451=905 ぴったり。7mm は 907 で入らない）', () => {
    const hints = findSavingHints(jobWith(445, 4))
    expect(hints).toHaveLength(1)
    expect(hints[0].change).toEqual({ kind: 'allowance', value: 6 })
    expect(hints[0].materials).toEqual([{ boardId: LUMBER_18_ID, label: 'シナランバー 18mm', from: 4, to: 2 }])
    expect(hints[0].message).toBe('切り代を 6mm にすると、シナランバー 18mm が 2 枚減ります（4枚 → 2枚）')
  })

  it('7mm でぴったり入り 8mm では入らない（W444：451+3+451=905、452+3+452=907）→ 切り代を 7mm', () => {
    const hints = findSavingHints(jobWith(444, 2))
    expect(hints.map((h) => h.message)).toEqual(['切り代を 7mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
  })

  it('今の切り代が 8 なら 1mm だけ下げた 7mm を出す。切り代で減るので端切りのお知らせは出さない', () => {
    // 端切り3 でも減る（452+3+452=907 は 910-3=907 に入る）が、切り代を優先する
    const hints = findSavingHints(jobWith(444, 2, { allowance: 8 }))
    expect(hints.map((h) => h.change)).toEqual([{ kind: 'allowance', value: 7 }])
  })

  it('今の切り代 7 で入っているなら何も出さない', () => {
    expect(findSavingHints(jobWith(444, 2, { allowance: 7 }))).toEqual([])
  })

  it('今の値が小数（7.5）なら 7 から試す', () => {
    // W444・切り代7.5：451.5+3+451.5=906 で入らない。7 で入る
    const hints = findSavingHints(jobWith(444, 2, { allowance: 7.5 }))
    expect(hints.map((h) => h.change)).toEqual([{ kind: 'allowance', value: 7 }])
  })

  it('最後に 0.5mm を試す（W450.5：切り代1 は 451.5+3+451.5=906 で入らず、0.5 で 905 ぴったり）', () => {
    const hints = findSavingHints(jobWith(450.5, 2, { allowance: 5 }))
    expect(hints.map((h) => h.message)).toEqual(['切り代を 0.5mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
  })

  it('切り代 0mm は試さない（W451・切り代1：0.5 は 906 で入らず、0 なら入るが試さない）→ 端切りを試して 3mm', () => {
    // 端切り t：452+3+452=907 ≤ 910 - t → t ≤ 3
    const hints = findSavingHints(jobWith(451, 2, { allowance: 1 }))
    expect(hints.map((h) => h.message)).toEqual(['端切りを 3mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
  })

  it('今の切り代が 0.5 なら切り代は試さず、端切りを試す（W451：906 ≤ 910 - 4）', () => {
    const hints = findSavingHints(jobWith(451, 2, { allowance: 0.5 }))
    expect(hints.map((h) => h.change)).toEqual([{ kind: 'trim', value: 4 }])
  })

  it('端切りだけで減るとき（W452・切り代1：0.5 は 908 で入らない。端切り1 なら 909 に 909 がぴったり）', () => {
    const hints = findSavingHints(jobWith(452, 2, { allowance: 1 }))
    expect(hints.map((h) => h.message)).toEqual(['端切りを 1mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
  })

  it('端切り 0mm は試さない（W453.5・切り代0：910 は端切り0 でしか入らない）', () => {
    expect(findSavingHints(jobWith(453.5, 2, { allowance: 0 }))).toEqual([])
  })

  it('切り代0・W452（452+3+452=907 > 905）は切り代を試せないので端切りを試し、3mm で減る', () => {
    // 端切り t：使える幅 910 - t。907 ≤ 910 - t → t ≤ 3
    const hints = findSavingHints(jobWith(452, 2, { allowance: 0 }))
    expect(hints.map((h) => h.message)).toEqual(['端切りを 3mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
  })

  it('切り代0・W453 ×2枚 は 端切りを 1mm にすると 1枚減る（909 は 910 - 1 = 909 にぴったり入る。端切り2 では 908 で入らない）', () => {
    const hints = findSavingHints(jobWith(453, 2, { allowance: 0 }))
    expect(hints.map((h) => h.message)).toEqual(['端切りを 1mm にすると、シナランバー 18mm が 1 枚減ります（2枚 → 1枚）'])
    expect(hints[0].change).toEqual({ kind: 'trim', value: 1 })
  })

  it('刃厚ぶん入らないとき（W454：454+3+454=911 > 910）は端切りでも減らない', () => {
    expect(findSavingHints(jobWith(454, 2, { allowance: 0 }))).toEqual([])
  })

  it('端切りが小数（5.5）なら 5 から試す', () => {
    // W452・切り代0：907 ≤ 910 - t → t ≤ 3
    const hints = findSavingHints(jobWith(452, 2, { allowance: 0, trim: 5.5 }))
    expect(hints.map((h) => h.change)).toEqual([{ kind: 'trim', value: 3 }])
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

  it('切り代・端切りがともに 0 なら何も試さない', () => {
    expect(findSavingHints(jobWith(445, 4, { allowance: 0, trim: 0 }))).toEqual([])
  })

  it('部材ごとの切り代の上書きはそのまま（上書き10 の部材は、仕事の切り代を下げても減らない）', () => {
    const job = jobWith(445, 4)
    job.parts[0].allowance = 10
    expect(findSavingHints(job)).toEqual([])
  })

  it('同じ値で複数の材料が減るときは、材料ごとの枚数を「、」でつなぐ', () => {
    const job = jobWith(445, 4)
    job.boards = bookshelfJob().boards
    job.parts.push(
      part({ id: 'p2', name: '背板', boardId: VENEER_4_ID, expr: { W: '445', H: '1800', D: '4' }, quantity: 2 }),
    )
    const hints = findSavingHints(job)
    expect(hints).toHaveLength(1)
    expect(hints[0].message).toBe(
      '切り代を 6mm にすると、シナランバー 18mm が 2 枚（4枚 → 2枚）、シナベニヤ 4mm が 1 枚（2枚 → 1枚）減ります',
    )
  })

  it('材料ごとに減る一番大きい値が違えば、それぞれの値で出す（大きい値から）', () => {
    // シナランバー W444 ×4：7mm 以下で 4→2。シナベニヤ W448 ×2：3mm 以下で 2→1（451+3+451=905）
    const job = jobWith(444, 4)
    job.boards = bookshelfJob().boards
    job.parts.push(part({ id: 'p2', name: '背板', boardId: VENEER_4_ID, expr: { W: '448', H: '1800', D: '4' }, quantity: 2 }))
    const hints = findSavingHints(job)
    expect(hints.map((h) => h.change)).toEqual([
      { kind: 'allowance', value: 7 },
      { kind: 'allowance', value: 3 },
    ])
    expect(hints[0].materials.map((m) => [m.label, m.from, m.to])).toEqual([['シナランバー 18mm', 4, 2]])
    // 3mm のお知らせは、その値で減る材料をすべて出す
    expect(hints[1].materials.map((m) => [m.label, m.from, m.to])).toEqual([
      ['シナランバー 18mm', 4, 2],
      ['シナベニヤ 4mm', 2, 1],
    ])
  })

  it('切り代で減る材料は端切りのお知らせに入れない。切り代で減らない材料だけ端切りで知らせる（切り代 → 端切りの順）', () => {
    // シナランバー W442 ×4（切り代10）：452+3+452=907 > 905 で 4枚。切り代9 で 905 に入り 2枚（端切り3 でも入る）
    // シナベニヤ W453 ×2（部材の切り代 0 で上書き）：切り代を変えても変わらない。端切り1 で 909 に入り 1枚
    const job = jobWith(442, 4)
    job.boards = bookshelfJob().boards
    job.parts.push(
      part({ id: 'p2', name: '背板', boardId: VENEER_4_ID, expr: { W: '453', H: '1800', D: '4' }, quantity: 2, allowance: 0 }),
    )
    const hints = findSavingHints(job)
    expect(hints.map((h) => h.message)).toEqual([
      '切り代を 9mm にすると、シナランバー 18mm が 2 枚減ります（4枚 → 2枚）',
      '端切りを 1mm にすると、シナベニヤ 4mm が 1 枚減ります（2枚 → 1枚）',
    ])
  })

  it('部材150枚・端切り5・切り代10・おまかせでも数秒以内に終わる', () => {
    const job = bookshelfJob()
    job.settings = { ...job.settings, trim: 5, allowance: 10, cutMode: 'auto' }
    job.boards = job.boards.filter((b) => b.id === LUMBER_18_ID)
    job.parts = Array.from({ length: 15 }, (_, i) =>
      part({
        id: `q${i}`,
        name: `棚${i + 1}`,
        expr: { W: String(100 + ((i * 131) % 780)), H: '18', D: String(80 + ((i * 71) % 600)) },
        thicknessAxis: 'H',
        quantity: 10,
        grain: i % 2 === 0 ? 'any' : 'D',
      }),
    )
    const t = performance.now()
    findSavingHints(job)
    expect(performance.now() - t).toBeLessThan(3000)
  })
})

describe('findSavingHints：新しい仕事の材料（4×8）で切り代を変えたとき（不具合の報告の確かめ）', () => {
  // 新しい仕事と同じ材料（メラミン1・ラワン2.5・ラワン4・ラワン5.5、4×8 1220×2440）
  // 縦切り優先：妻手方向に使える幅は 1220 - 5 = 1215。
  // W602 を2枚並べると (602 + 切り代) × 2 + 3。切り代5 は 1217 で入らず、4 なら 1215 ぴったり
  let seq = 0
  const newId = (prefix: string) => `${prefix}-${++seq}`

  function newJobWith(settings: Partial<Settings>, parts: Partial<Part>[]): Job {
    seq = 0
    const boards = defaultBoards(newId)
    const lauan4 = boards[2].id
    return {
      id: 'job-1',
      name: '棚',
      settings: { ...defaultSettings(), ...settings },
      boards,
      parts: parts.map((p, i) => ({
        id: `p${i + 1}`,
        name: `背板${i + 1}`,
        boardId: lauan4,
        expr: { W: '602', H: '1200', D: '4' },
        thicknessAxis: null,
        quantity: 4,
        grain: 'H',
        memo: '',
        checks: { finished: false, cut: false },
        allowance: null,
        ...p,
      })),
      createdAt: '',
      updatedAt: '',
    }
  }

  const HINT_4 = '切り代を 4mm にすると、ラワン 4mm が 1 枚減ります（2枚 → 1枚）'

  it.each(['vertical', 'horizontal', 'auto'] as const)('切り代5（%s）なら 4mm のお知らせが出る', (cutMode) => {
    const hints = findSavingHints(newJobWith({ allowance: 5, cutMode }, [{}]))
    expect(hints.map((h) => h.message)).toEqual([HINT_4])
  })

  it('切り代0 では切り代のお知らせは出ない。同じ仕事で切り代を 5 に変えると、すぐに 4mm のお知らせになる', () => {
    const at0 = newJobWith({ allowance: 0 }, [{}])
    expect(findSavingHints(at0).filter((h) => h.change.kind === 'allowance')).toEqual([])
    // 設定の画面で切り代を変えたときと同じく、設定だけ新しくした仕事を渡す
    const at5 = { ...at0, settings: { ...at0.settings, allowance: 5 } }
    expect(findSavingHints(at5).map((h) => h.message)).toEqual([HINT_4])
    // もう一度 0 に戻すと、また出ない（前の結果を覚えていない）
    expect(findSavingHints(at0).filter((h) => h.change.kind === 'allowance')).toEqual([])
  })

  it('部材の切り代が空欄なら仕事の切り代を使う。部材の切り代に 5 を入れた部材は、仕事の切り代を下げても変わらない', () => {
    expect(findSavingHints(newJobWith({ allowance: 5 }, [{ allowance: null }])).map((h) => h.message)).toEqual([HINT_4])
    // 切り代のお知らせは出ず、端切り（607+3+607=1217 ≤ 1220 - 3）のお知らせだけになる
    const fixed = findSavingHints(newJobWith({ allowance: 5 }, [{ allowance: 5 }]))
    expect(fixed.map((h) => h.change)).toEqual([{ kind: 'trim', value: 3 }])
    // 部材の切り代 5・仕事の切り代 10 でも同じ（仕事の切り代は使われていない）
    expect(findSavingHints(newJobWith({ allowance: 10 }, [{ allowance: 5 }]))).toEqual(fixed)
  })

  it('仕事の切り代10・部材の切り代は空欄：10 から下げていき、一番大きい 4mm を出す', () => {
    const hints = findSavingHints(newJobWith({ allowance: 10 }, [{}]))
    expect(hints.map((h) => h.message)).toEqual([HINT_4])
  })

  it('材料が複数あり、ほかの材料（ラワン 5.5）が減らなくても、減る材料だけを知らせる', () => {
    const job = newJobWith({ allowance: 5, cutMode: 'auto' }, [{}])
    // ラワン 5.5 の部材：1枚で 2枚必要（W1215 は 1215 ぴったりに1枚。2枚目は入らない）
    job.parts.push({
      ...job.parts[0],
      id: 'p2',
      name: '底板',
      boardId: job.boards[3].id,
      expr: { W: '1210', H: '2000', D: '5.5' },
      quantity: 2,
    })
    const hints = findSavingHints(job)
    expect(hints.map((h) => h.message)).toEqual([HINT_4])
  })
})

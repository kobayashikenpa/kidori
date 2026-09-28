import { describe, expect, it } from 'vitest'
import { bookshelfJob, LUMBER_18_ID } from '../fixtures/bookshelf'
import {
  partsUsingBoardThickness,
  partsUsingBoardThicknesses,
  partsUsingNige,
  partsUsingNiges,
  jobRefIds,
  remapBoardIds,
  remapRefIds,
} from './usages'
import { FLUSH_25_ID, flushJob, LAUAN_4_ID, MELAMINE_1_ID } from '../fixtures/flush'

describe('partsUsingNige（逃げを式で使っている部材）', () => {
  it('見本の逃げ1mm は［棚板（W）］', () => {
    expect(partsUsingNige(bookshelfJob(), 'nige-1')).toEqual(['棚板（W）'])
  })

  it('見本の逃げ0.5mm は使われていない', () => {
    expect(partsUsingNige(bookshelfJob(), 'nige-0.5')).toEqual([])
  })

  it('1つの部材で複数の軸に使っていれば軸を並べる（部材の並び順）', () => {
    const job = bookshelfJob()
    job.parts[1].expr.D = '全体.D - {n:nige-1}'
    job.parts[3].expr.D = '全体.D - 20 - {n:nige-1}'
    expect(partsUsingNige(job, 'nige-1')).toEqual(['側板（D）', '棚板（W・D）'])
  })

  it('読めない式の中でも見つける', () => {
    const job = bookshelfJob()
    job.parts[0].expr.H = '1800 - {n:nige-1} @'
    expect(partsUsingNige(job, 'nige-1')).toEqual(['全体（H）', '棚板（W）'])
  })
})

describe('partsUsingBoardThickness（材料の厚みを式で使っている部材）', () => {
  it('式で {t:id} を使っている部材名と軸', () => {
    const job = bookshelfJob()
    job.parts[2].expr.W = `全体.W - {t:${LUMBER_18_ID}} * 2`
    expect(partsUsingBoardThickness(job, LUMBER_18_ID)).toEqual(['天地板（W）'])
  })

  it('見本では式で厚みを使っていない', () => {
    expect(partsUsingBoardThickness(bookshelfJob(), LUMBER_18_ID)).toEqual([])
  })

  it('逃げの id と同じ文字でも、逃げは数えない', () => {
    const job = bookshelfJob()
    job.parts[2].expr.W = '{n:x} + 1'
    expect(partsUsingBoardThickness(job, 'x')).toEqual([])
  })
})

describe('partsUsingNiges（いくつかの逃げのどれかを式で使っている部材）', () => {
  it('部材ごとに1つ、軸はまとめる（部材の並び順）', () => {
    const job = bookshelfJob()
    job.parts[1].expr.D = '全体.D - {n:nige-0.5}'
    job.parts[3].expr.D = '全体.D - 20 - {n:nige-0.5}'
    expect(partsUsingNiges(job, ['nige-1', 'nige-0.5'])).toEqual(['側板（D）', '棚板（W・D）'])
  })

  it('1つの軸で2つ使っていても軸は1回', () => {
    const job = bookshelfJob()
    job.parts[3].expr.W = '全体.W - {n:nige-1} - {n:nige-0.5}'
    expect(partsUsingNiges(job, ['nige-1', 'nige-0.5'])).toEqual(['棚板（W）'])
  })

  it('id が1つなら partsUsingNige と同じ。空なら空', () => {
    expect(partsUsingNiges(bookshelfJob(), ['nige-1'])).toEqual(partsUsingNige(bookshelfJob(), 'nige-1'))
    expect(partsUsingNiges(bookshelfJob(), [])).toEqual([])
  })

  it('材料の厚みは数えない', () => {
    const job = bookshelfJob()
    job.parts[2].expr.W = '{t:nige-1} + 1'
    expect(partsUsingNiges(job, ['nige-1'])).toEqual(['棚板（W）'])
  })
})

describe('partsUsingBoardThicknesses（いくつかの材料のどれかの厚みを式で使っている部材）', () => {
  it('どれかの厚みを使っている部材名と軸', () => {
    const job = bookshelfJob()
    job.parts[2].expr.W = `全体.W - {t:${LUMBER_18_ID}} * 2`
    job.parts[4].expr.H = '全体.H - {t:other}'
    expect(partsUsingBoardThicknesses(job, [LUMBER_18_ID, 'other'])).toEqual(['天地板（W）', `${job.parts[4].name}（H）`])
  })

  it('逃げは数えない', () => {
    const job = bookshelfJob()
    job.parts[2].expr.W = '{n:x} + 1'
    expect(partsUsingBoardThicknesses(job, ['x'])).toEqual([])
  })
})

describe('remapBoardIds（材料の id のつけ替え）', () => {
  const map = new Map([['a', 'b']])

  it('{t:a} を {t:b} にし、ほかの部分は変えない', () => {
    expect(remapBoardIds('全体.W -  {t:a}*2 + {n:a} + {t:c}', map)).toBe('全体.W -  {t:b}*2 + {n:a} + {t:c}')
  })

  it('同じ id が何度出てきても全部つけ替える', () => {
    expect(remapBoardIds('{t:a}+{t:a}', map)).toBe('{t:b}+{t:b}')
  })

  it('厚みを使っていない式はそのまま', () => {
    expect(remapBoardIds('900 - 側板.W', map)).toBe('900 - 側板.W')
    expect(remapBoardIds('', map)).toBe('')
  })
})

describe('remapRefIds（材料の厚み・逃げの id のつけ替え）', () => {
  const thickness = new Map([['a', 'A2']])
  const nige = new Map([['a', 'N2']])

  it('{t:} は thickness の表、{n:} は nige の表でつけ替え、部材の参照はそのまま', () => {
    expect(remapRefIds('天地板.W - {n:a} + {t:a}', { thickness, nige })).toBe('天地板.W - {n:N2} + {t:A2}')
  })

  it('thickness の表だけなら remapBoardIds と同じ結果（{n:} は変えない）', () => {
    const e = '全体.W -  {t:a}*2 + {n:a} + {t:c}'
    expect(remapRefIds(e, { thickness })).toBe(remapBoardIds(e, thickness))
    expect(remapRefIds(e, { thickness })).toBe('全体.W -  {t:A2}*2 + {n:a} + {t:c}')
  })

  it('nige の表だけなら {t:} は変えない', () => {
    expect(remapRefIds('{t:a} + {n:a}', { nige })).toBe('{t:a} + {n:N2}')
  })

  it('読めない式（構文エラー）の中の {n:} もつけ替える', () => {
    expect(remapRefIds('(天地板.W - {n:a} +', { nige })).toBe('(天地板.W - {n:N2} +')
  })

  it('表に無い id はそのまま', () => {
    expect(remapRefIds('{n:zz} + {t:zz}', { thickness, nige })).toBe('{n:zz} + {t:zz}')
  })
})

describe('jobRefIds（仕事で使っている材料・フラッシュ・逃げ）', () => {
  it('本棚の見本：材料 シナランバー18・シナベニヤ4、逃げ1 だけ（逃げ0.5 は入らない）', () => {
    const r = jobRefIds(bookshelfJob())
    expect([...r.boardIds].sort()).toEqual([LUMBER_18_ID, 'board-shina-veneer-4'].sort())
    expect([...r.flushIds]).toEqual([])
    expect([...r.nigeIds]).toEqual(['nige-1'])
  })

  it('フラッシュの部材は、フラッシュとその表面材を使っている', () => {
    const r = jobRefIds(flushJob())
    expect([...r.flushIds]).toEqual([FLUSH_25_ID])
    expect([...r.boardIds].sort()).toEqual([LAUAN_4_ID, MELAMINE_1_ID].sort())
  })

  it('式の {t:} で指した材料・フラッシュ（とその表面材）も使っている。無い id は入らない', () => {
    const job = flushJob()
    job.parts[0] = { ...job.parts[0], flushId: undefined, boardId: null, expr: { W: '900', H: `{t:${FLUSH_25_ID}}`, D: '{t:nothing} + {n:nige-x}' } }
    delete job.parts[0].flushId
    const r = jobRefIds(job)
    expect([...r.flushIds]).toEqual([FLUSH_25_ID])
    expect([...r.boardIds].sort()).toEqual([LAUAN_4_ID, MELAMINE_1_ID].sort())
    expect([...r.nigeIds]).toEqual([])
  })

  it('読めない式の中の {t:}・{n:} も数える', () => {
    const job = bookshelfJob()
    job.parts[1].expr.W = `({t:${LUMBER_18_ID}} + {n:nige-0.5}`
    job.parts[1].boardId = null
    job.parts[2].boardId = null
    job.parts[3].boardId = null
    const r = jobRefIds(job)
    expect(r.boardIds.has(LUMBER_18_ID)).toBe(true)
    expect(r.nigeIds.has('nige-0.5')).toBe(true)
  })
})

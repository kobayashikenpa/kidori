import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../fixtures/bookshelf'
import type { Job, Part } from '../types'
import { expandPieces } from './pieces'

function expand(job: Job) {
  return expandPieces(job, computeDimensions(job))
}

function group(job: Job, boardId: string) {
  return expand(job).groups.find((g) => g.board.id === boardId)!
}

function addPart(job: Job, p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>) {
  job.parts.push({
    boardId: LUMBER_18_ID,
    thicknessAxis: null,
    quantity: 1,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    clearance: {},
    allowance: null,
    ...p,
  })
}

describe('expandPieces（片の展開と木目による向き）', () => {
  it('見本：ランバーの片が8枚・ベニヤが1枚。板の登録順に分かれる', () => {
    const r = expand(bookshelfJob())
    expect(r.groups.map((g) => g.board.id)).toEqual([LUMBER_18_ID, VENEER_4_ID])
    expect(r.groups[0].pieces).toHaveLength(8)
    expect(r.groups[1].pieces).toHaveLength(1)
    expect(r.skipped).toEqual([])
  })

  it('片の id は 部材id#連番、名前は部材名', () => {
    const lumber = group(bookshelfJob(), LUMBER_18_ID)
    expect(lumber.pieces.map((p) => p.pieceId).slice(0, 3)).toEqual([
      'part-gawaita#1',
      'part-gawaita#2',
      'part-tenchiita#1',
    ])
    expect(lumber.pieces[0].name).toBe('側板')
  })

  it('全体（枚数0）は除かれる（除いた理由の一覧にも出さない）', () => {
    const r = expand(bookshelfJob())
    const names = r.groups.flatMap((g) => g.pieces.map((p) => p.name))
    expect(names).not.toContain('全体')
    expect(r.skipped).toEqual([])
  })

  it('板の木目が長辺方向：側板は y=1810・x=410、天地板は y=874・x=410（回転なし）', () => {
    const lumber = group(bookshelfJob(), LUMBER_18_ID)
    const gawa = lumber.pieces.find((p) => p.name === '側板')!
    const tenchi = lumber.pieces.find((p) => p.name === '天地板')!
    expect(gawa.orientations).toEqual([{ x: 410, y: 1810, rotated: false }])
    expect(tenchi.orientations).toEqual([{ x: 410, y: 874, rotated: false }])
  })

  it('背板（面 W×H・木目H）は H=1800 を y に置く（face[0]=W が y でないので rotated）', () => {
    const veneer = group(bookshelfJob(), VENEER_4_ID)
    expect(veneer.pieces[0].orientations).toEqual([{ x: 900, y: 1800, rotated: true }])
  })

  it('寸法の表記は面の2軸の順（寸法表と同じ）', () => {
    const r = expand(bookshelfJob())
    expect(r.groups[0].pieces[0].sizeLabel).toBe('1810×410')
    expect(r.groups[1].pieces[0].sizeLabel).toBe('900×1800')
  })

  it('板の木目が短辺方向なら、天地板は x=874・y=410', () => {
    const job = bookshelfJob()
    job.boards[0] = { ...job.boards[0], sizeKind: 'custom', grain: 'short' }
    const tenchi = group(job, LUMBER_18_ID).pieces.find((p) => p.name === '天地板')!
    expect(tenchi.orientations).toEqual([{ x: 874, y: 410, rotated: true }])
  })

  it('板の木目が短辺方向だと、側板（木目H 1810）は x に置けず入らない', () => {
    const job = bookshelfJob()
    job.boards[0] = { ...job.boards[0], sizeKind: 'custom', grain: 'short' }
    const g = group(job, LUMBER_18_ID)
    expect(g.pieces.some((p) => p.name === '側板')).toBe(false)
    expect(g.unplaced).toEqual([{ partId: 'part-gawaita', name: '側板', reason: 'tooLarge' }])
  })

  it('「どちらでもよい」は両方の向きを候補にする', () => {
    const job = bookshelfJob()
    job.parts.find((p) => p.name === '天地板')!.grain = 'any'
    const tenchi = group(job, LUMBER_18_ID).pieces.find((p) => p.name === '天地板')!
    expect(tenchi.orientations).toEqual([
      { x: 410, y: 874, rotated: false },
      { x: 874, y: 410, rotated: true },
    ])
  })

  it('「どちらでもよい」の正方形は向きを1つにまとめる', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'sq', name: '正方形', expr: { W: '290', H: '18', D: '290' } })
    const sq = group(job, LUMBER_18_ID).pieces.find((p) => p.name === '正方形')!
    expect(sq.orientations).toEqual([{ x: 300, y: 300, rotated: false }])
  })

  it('「どちらでもよい」で片方の向きだけ入るなら、その向きだけ残す', () => {
    const job = bookshelfJob()
    // 木取り 1000×300：1000 は x（使える幅 905）に入らないので y に置く
    addPart(job, { id: 'long', name: '長い板', expr: { W: '990', H: '18', D: '290' } })
    const p = group(job, LUMBER_18_ID).pieces.find((x) => x.name === '長い板')!
    expect(p.orientations).toEqual([{ x: 300, y: 1000, rotated: false }])
  })

  it('木目の軸が面にない（例：厚みの軸を指している）ときは「どちらでもよい」として扱う', () => {
    const job = bookshelfJob()
    job.parts.find((p) => p.name === '天地板')!.grain = 'H'
    const tenchi = group(job, LUMBER_18_ID).pieces.find((p) => p.name === '天地板')!
    expect(tenchi.orientations).toHaveLength(2)
  })

  it('1000×2000 の部材はサブロクに入らず unplaced。ほかの片はそのまま', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'big', name: '大きい板', expr: { W: '990', H: '18', D: '1990' }, quantity: 3 })
    const g = group(job, LUMBER_18_ID)
    expect(g.unplaced).toEqual([{ partId: 'big', name: '大きい板', reason: 'tooLarge' }])
    expect(g.pieces).toHaveLength(8)
  })

  it('幅 905 ぴったりは入り、906 は入らない（耳落とし5）', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'w905', name: 'ぴったり', expr: { W: '895', H: '18', D: '300' }, grain: 'W' })
    addPart(job, { id: 'w906', name: '1mm多い', expr: { W: '896', H: '18', D: '300' }, grain: 'D' })
    const g = group(job, LUMBER_18_ID)
    // ぴったり：木目W 905 を y に置く（x=310）ので入る。1mm多い：木目D 310 を y、906 を x → 入らない
    expect(g.pieces.some((p) => p.partId === 'w905')).toBe(true)
    expect(g.unplaced.map((u) => u.partId)).toEqual(['w906'])
  })

  it('板の短辺方向に 905 ぴったりの片は入る', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'w905', name: 'ぴったり', expr: { W: '895', H: '18', D: '300' }, grain: 'D' })
    const g = group(job, LUMBER_18_ID)
    expect(g.pieces.find((p) => p.partId === 'w905')!.orientations).toEqual([{ x: 905, y: 310, rotated: true }])
    expect(g.unplaced).toEqual([])
  })

  it('横切り優先では長手も端切りするので、長手 1815 までが入る（1816 は入らない）。縦切り優先・おまかせは 1820 まで', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'l1815', name: 'ぴったり', expr: { W: '290', H: '18', D: '1805' }, grain: 'D' })
    addPart(job, { id: 'l1816', name: '1mm多い', expr: { W: '290', H: '18', D: '1806' }, grain: 'D' })
    job.settings.cutMode = 'horizontal'
    expect(group(job, LUMBER_18_ID).unplaced.map((u) => u.partId)).toEqual(['l1816'])
    job.settings.cutMode = 'vertical'
    expect(group(job, LUMBER_18_ID).unplaced).toEqual([])
    job.settings.cutMode = 'auto'
    expect(group(job, LUMBER_18_ID).unplaced).toEqual([])
  })

  it('板が未設定・存在しない板・寸法エラーの部材は理由つきで除く（枚数0は理由なしで除く）', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'nb', name: '板なし', boardId: null, expr: { W: '100', H: '18', D: '100' } })
    addPart(job, { id: 'gone', name: '消えた板', boardId: 'no-such', expr: { W: '100', H: '18', D: '100' } })
    addPart(job, { id: 'err', name: 'エラー', expr: { W: '天板.W', H: '18', D: '100' } })
    addPart(job, { id: 'zero', name: '枚数0のエラー', expr: { W: '天板.W', H: '18', D: '100' }, quantity: 0 })
    expect(expand(job).skipped).toEqual([
      { partId: 'nb', name: '板なし', reason: 'noBoard' },
      { partId: 'gone', name: '消えた板', reason: 'noBoard' },
      { partId: 'err', name: 'エラー', reason: 'dimensionError' },
    ])
  })

  it('厚みの寸法が決まらない（面が決まらない）部材は、寸法エラーとは別の理由（noThickness）で除く', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'nothick', name: '厚み不明', expr: { W: '100', H: '20', D: '100' } })
    expect(expand(job).skipped).toEqual([{ partId: 'nothick', name: '厚み不明', reason: 'noThickness' }])
  })

  it('式のエラーがあれば、厚みが決まらなくても寸法エラーとして除く', () => {
    const job = bookshelfJob()
    addPart(job, { id: 'both', name: '両方', expr: { W: '天板.W', H: '20', D: '100' } })
    expect(expand(job).skipped).toEqual([{ partId: 'both', name: '両方', reason: 'dimensionError' }])
  })

  it('片のない板は結果に出さない', () => {
    const job = bookshelfJob()
    job.parts = job.parts.filter((p) => p.boardId !== VENEER_4_ID)
    expect(expand(job).groups.map((g) => g.board.id)).toEqual([LUMBER_18_ID])
  })
})

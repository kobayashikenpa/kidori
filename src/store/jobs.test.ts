import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../engine/defaults'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../engine/fixtures/bookshelf'
import { computeDimensions } from '../engine/dimensions'
import { DEFAULT_SETTINGS, type Job } from '../engine/types'
import {
  addBoard,
  addNige,
  addPart,
  boardsUsages,
  boardLabel,
  copyJob,
  copyName,
  createJob,
  deleteJob,
  newBoard,
  newPart,
  nigeUsages,
  nigesUsages,
  partsReferencing,
  partsUsingBoard,
  removeBoards,
  removeNiges,
  removePart,
  renameJob,
  setBoardSize,
  setPartChecks,
  updateBoard,
  updateNige,
  updatePart,
  updateSettings,
  type OpResult,
} from './jobs'

function unwrap(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

describe('createJob', () => {
  it('新しい仕事の設定は初期値（逃げ0.5mm・逃げ1mm）で、材料は4つ、部材はない', () => {
    const job = createJob('食器棚', undefined, new Date('2026-09-01T00:00:00Z'), 'job-1')
    expect(job.settings).toEqual(defaultSettings())
    expect(job.settings).not.toBe(DEFAULT_SETTINGS)
    expect(job.settings.nige.map((n) => n.value)).toEqual([0.5, 1])
    expect(job.boards.map(boardLabel)).toEqual(['メラミン 1mm', 'ラワン 2.5mm', 'ラワン 4mm', 'ラワン 5.5mm'])
    for (const b of job.boards) {
      expect([b.sizeKind, b.width, b.length, b.grain]).toEqual(['shihachi', 1220, 2440, 'long'])
    }
    expect(new Set(job.boards.map((b) => b.id)).size).toBe(4)
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
    expect(job.settings).toEqual({ ...defaultSettings(), kerf: 4, cutMode: 'auto' })
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
    const job = unwrap(updatePart(bookshelfJob(), 'part-tanaita', { quantity: 5, allowance: 3 }))
    const tana = job.parts.find((p) => p.id === 'part-tanaita')!
    expect(tana.quantity).toBe(5)
    expect(tana.allowance).toBe(3)
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
    const job = unwrap(removeBoards(bookshelfJob(), [LUMBER_18_ID]))
    expect(job.boards.map((b) => b.id)).toEqual([VENEER_4_ID])
    const unset = job.parts.filter((p) => p.boardId === null).map((p) => p.name)
    expect(unset).toEqual(['全体', '側板', '天地板', '棚板'])
    expect(job.parts.find((p) => p.name === '背板')!.boardId).toBe(VENEER_4_ID)
  })

  it('見本の板2つを新しい仕事に登録できる（新しく足す材料は 4×8。第1.3版）', () => {
    let job = createJob('本棚')
    job = { ...job, boards: [] }
    job = unwrap(addBoard(job, newBoard({ material: 'シナランバー', thickness: 18 })))
    job = unwrap(addBoard(job, newBoard({ material: 'シナベニヤ', thickness: 4 })))
    expect(job.boards.map(boardLabel)).toEqual(['シナランバー 18mm', 'シナベニヤ 4mm'])
    expect(job.boards[0]).toMatchObject({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
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

describe('partsReferencing', () => {
  it('見本で全体を参照している部材', () => {
    expect(partsReferencing(bookshelfJob(), 'part-zentai')).toEqual(['側板', '天地板', '棚板', '背板'])
  })
  it('天地板を参照しているのは棚板だけ', () => {
    expect(partsReferencing(bookshelfJob(), 'part-tenchiita')).toEqual(['棚板'])
  })
  it('だれも参照していなければ空', () => {
    expect(partsReferencing(bookshelfJob(), 'part-seita')).toEqual([])
  })
})

describe('仕事の名前・コピー・削除', () => {
  it('名前を変える。前後の空白は落とし、空の名前は断る', () => {
    expect(unwrap(renameJob(bookshelfJob(), '  食器棚 ')).name).toBe('食器棚')
    expect(renameJob(bookshelfJob(), '   ').ok).toBe(false)
  })

  it('コピーの名前は「〇〇 のコピー」。重なれば番号を付ける', () => {
    expect(copyName('本棚 W900', ['本棚 W900'])).toBe('本棚 W900 のコピー')
    expect(copyName('本棚 W900', ['本棚 W900', '本棚 W900 のコピー'])).toBe('本棚 W900 のコピー 2')
    expect(copyName('本棚 W900', ['本棚 W900 のコピー', '本棚 W900 のコピー 2'])).toBe('本棚 W900 のコピー 3')
  })

  it('コピーは新しい id で、板・部材の id も新しく、部材の板は新しい板につけ替わる', () => {
    const src = bookshelfJob()
    const copy = copyJob(src, [src.name], new Date('2026-09-25T00:00:00Z'), 'job-copy')
    expect(copy.id).toBe('job-copy')
    expect(copy.name).toBe('本棚 W900 のコピー')
    expect(copy.createdAt).toBe('2026-09-25T00:00:00.000Z')
    expect(copy.updatedAt).toBe('2026-09-25T00:00:00.000Z')
    expect(copy.settings).toEqual(src.settings)
    expect(copy.boards).toHaveLength(src.boards.length)
    expect(copy.parts).toHaveLength(src.parts.length)
    const srcBoardIds = new Set(src.boards.map((b) => b.id))
    const srcPartIds = new Set(src.parts.map((p) => p.id))
    for (const b of copy.boards) expect(srcBoardIds.has(b.id)).toBe(false)
    for (const p of copy.parts) expect(srcPartIds.has(p.id)).toBe(false)
    // シナランバー18 を使っている部材は、コピーでもコピーのシナランバー18 を使う
    const lumber = copy.boards.find((b) => b.material === 'シナランバー' && b.thickness === 18)
    expect(lumber).toBeDefined()
    expect(partsUsingBoard(copy, lumber!.id)).toEqual(partsUsingBoard(src, LUMBER_18_ID))
    // 式は名前で参照しているので、そのまま
    expect(copy.parts.map((p) => p.expr)).toEqual(src.parts.map((p) => p.expr))
  })

  it('コピーの寸法は元と同じに計算できる', () => {
    const src = bookshelfJob()
    const copy = copyJob(src, [])
    const strip = (job: Job) =>
      computeDimensions(job).parts.map((d) => ({ name: d.name, finished: d.finished, cutSize: d.cutSize }))
    expect(computeDimensions(copy).errors).toEqual([])
    expect(strip(copy)).toEqual(strip(src))
  })

  it('コピーを変えても元の仕事は変わらない（深いコピー）', () => {
    const src = bookshelfJob()
    const copy = copyJob(src, [])
    const side = copy.parts.find((p) => p.name === '側板')!
    side.expr.H = '1'
    side.checks.cut = true
    copy.settings.nige[0].value = 9
    copy.settings.kerf = 9
    expect(src.parts.find((p) => p.name === '側板')!.expr.H).not.toBe('1')
    expect(src.parts.find((p) => p.name === '側板')!.checks.cut).toBe(false)
    expect(src.settings.nige[0].value).toBe(0.5)
    expect(src.settings.kerf).toBe(3)
  })

  it('仕事を消す。開いていた仕事を消すと、何も開いていない状態になる', () => {
    const a = createJob('a', undefined, new Date(), 'a')
    const b = createJob('b', undefined, new Date(), 'b')
    expect(deleteJob([a, b], 'a', 'a')).toEqual({ jobs: [b], currentJobId: null })
    expect(deleteJob([a, b], 'b', 'a')).toEqual({ jobs: [b], currentJobId: 'b' })
    expect(deleteJob([a, b], null, 'x')).toEqual({ jobs: [a, b], currentJobId: null })
  })
})

describe('逃げ', () => {
  it('逃げ1mm をもう1つ足すとエラー、逃げ2mm は足せて末尾に並ぶ', () => {
    const job = createJob('a')
    const dup = addNige(job, '逃げ', 1)
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.message).toBe('逃げ1 はすでにあります')
    const next = unwrap(addNige(job, '逃げ', 2, 'nige-x'))
    expect(next.settings.nige).toEqual([...job.settings.nige, { id: 'nige-x', name: '逃げ', value: 2 }])
    expect(job.settings.nige).toHaveLength(2)
  })

  it('0 以下・数でない寸法は足せない', () => {
    const job = createJob('a')
    expect(addNige(job, '逃げ', 0).ok).toBe(false)
    expect(addNige(job, '逃げ', -1).ok).toBe(false)
    expect(addNige(job, '逃げ', Number.NaN).ok).toBe(false)
  })

  it('名前が違えば同じ寸法でも足せる（ほぞ1）。名前は前後の空白を外し、空なら断る', () => {
    const job = createJob('a')
    const next = unwrap(addNige(job, ' ほぞ ', 1, 'n-hozo'))
    expect(next.settings.nige.at(-1)).toEqual({ id: 'n-hozo', name: 'ほぞ', value: 1 })
    const dup = addNige(next, 'ほぞ', 1)
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.message).toBe('ほぞ1 はすでにあります')
    expect(addNige(job, '  ', 1).ok).toBe(false)
  })

  it('名前と寸法を変えられる。式は id で参照しているので表示と値がついてくる', () => {
    const job = bookshelfJob()
    const next = unwrap(updateNige(job, 'nige-1', 'ほぞ', 15))
    expect(next.settings.nige[1]).toEqual({ id: 'nige-1', name: 'ほぞ', value: 15 })
    expect(computeDimensions(next).parts.find((d) => d.name === '棚板')!.finished?.W).toBe(849)
    expect(unwrap(updateNige(job, 'nige-1', '逃げ', 1)).settings.nige[1].value).toBe(1)
    expect(updateNige(job, 'nige-1', '', 1).ok).toBe(false)
  })

  it('表示名（名前＋寸法）がほかと同じになるものは足せない・変えられない（逃げ1 と 5 → 逃げ15、逃げ と 15 → 逃げ15）', () => {
    const job = unwrap(addNige(createJob('a'), '逃げ', 15, 'n-15'))
    const add = addNige(job, '逃げ1', 5)
    expect(add.ok).toBe(false)
    if (!add.ok) expect(add.message).toBe('逃げ15 はすでにあります')
    // 全角の「１」でも同じ表示名とみなす
    expect(addNige(job, '逃げ１', 5).ok).toBe(false)
    // 逆向き：先に「逃げ1」5 があって「逃げ」15 を足す
    const job2 = unwrap(addNige(createJob('a'), '逃げ1', 5, 'n-x'))
    expect(addNige(job2, '逃げ', 15).ok).toBe(false)
    // 変更でも同じ
    const upd = updateNige(job, 'nige-1', '逃げ1', 5)
    expect(upd.ok).toBe(false)
    if (!upd.ok) expect(upd.message).toBe('逃げ15 はすでにあります')
    // 自分自身と同じ表示名への変更（名前の分け方を変えるだけ）はよい
    expect(unwrap(updateNige(job, 'n-15', '逃げ1', 5)).settings.nige.at(-1)).toEqual({ id: 'n-15', name: '逃げ1', value: 5 })
    // 表示名が違えば足せる（逃げ1 と 6 → 逃げ16）
    expect(addNige(job, '逃げ1', 6).ok).toBe(true)
  })

  it('寸法は丸めずに持つ：逃げ0.25 を足しても 0.25、名前だけ変えても 0.25 のままで式の結果も変わらない', () => {
    const job = unwrap(updateNige(bookshelfJob(), 'nige-1', '逃げ', 0.25))
    expect(job.settings.nige[1]).toEqual({ id: 'nige-1', name: '逃げ', value: 0.25 })
    const before = computeDimensions(job).parts.find((d) => d.name === '棚板')!.finished?.W
    const renamed = unwrap(updateNige(job, 'nige-1', 'すき間', 0.25))
    expect(renamed.settings.nige[1]).toEqual({ id: 'nige-1', name: 'すき間', value: 0.25 })
    expect(computeDimensions(renamed).parts.find((d) => d.name === '棚板')!.finished?.W).toBe(before)
    expect(unwrap(addNige(createJob('a'), 'ほぞ', 0.25, 'n-h')).settings.nige.at(-1)!.value).toBe(0.25)
    // 表示名が違えば別のもの（逃げ0.25 と 逃げ0.3）
    expect(addNige(job, '逃げ', 0.3).ok).toBe(true)
    // 浮動小数の誤差だけの違いは同じものとみなす
    expect(addNige(job, '逃げ', 0.1 + 0.15).ok).toBe(false)
    // 0 より大きければ小さい値も持てる
    expect(addNige(job, '逃げ', 0.04).ok).toBe(true)
  })

  it('寸法を変えると式の値がついてくる。ほかの逃げと同じ寸法には変えられない', () => {
    const job = bookshelfJob()
    expect(updateNige(job, 'nige-1', '逃げ', 0.5).ok).toBe(false)
    const next = unwrap(updateNige(job, 'nige-1', '逃げ', 2))
    const shelf = computeDimensions(next).parts.find((d) => d.name === '棚板')!
    expect(shelf.finished?.W).toBe(862)
  })

  it('見本の逃げ1mm を使っているのは［棚板（W）］、逃げ0.5mm はだれも使っていない', () => {
    const job = bookshelfJob()
    expect(nigeUsages(job, 'nige-1')).toEqual(['棚板（W）'])
    expect(nigeUsages(job, 'nige-0.5')).toEqual([])
  })

  it('逃げを消すと、使っていた寸法は missingNige になる', () => {
    const job = unwrap(removeNiges(bookshelfJob(), ['nige-1']))
    expect(job.settings.nige.map((n) => n.id)).toEqual(['nige-0.5'])
    const errs = computeDimensions(job).errors
    expect(errs.some((e) => e.kind === 'missingNige')).toBe(true)
  })
})

describe('材料の厚みを式で使うとき', () => {
  function jobWithThickness(): Job {
    const job = createJob('箱')
    const rawan4 = job.boards.find((b) => b.material === 'ラワン' && b.thickness === 4)!
    return unwrap(
      addPart(job, newPart({ name: '底板', boardId: rawan4.id, expr: { W: `600 - {t:${rawan4.id}} * 2`, H: '4', D: '300' } })),
    )
  }

  it('削除の確認用に、その板から切る部材と、式で厚みを使っている部材を返す', () => {
    const job = jobWithThickness()
    const rawan4 = job.boards.find((b) => b.thickness === 4)!
    expect(boardsUsages(job, [rawan4.id])).toEqual({ cutFrom: ['底板'], thickness: ['底板（W）'], flushes: [] })
  })

  it('コピー先の式は新しい板の id を指し、同じ寸法になる', () => {
    const src = jobWithThickness()
    const copy = copyJob(src, [])
    const newRawan4 = copy.boards.find((b) => b.thickness === 4)!
    expect(copy.parts[0].expr.W).toBe(`600 - {t:${newRawan4.id}} * 2`)
    expect(computeDimensions(copy).parts[0].finished).toEqual(computeDimensions(src).parts[0].finished)
    expect(computeDimensions(copy).parts[0].finished?.W).toBe(592)
  })
})

describe('メモと加工のチェック', () => {
  it('チェックを付けても寸法は変わらない', () => {
    const job = bookshelfJob()
    const shelf = job.parts.find((p) => p.name === '棚板')!
    const next = unwrap(setPartChecks(job, shelf.id, { cut: true }))
    expect(next.parts.find((p) => p.id === shelf.id)!.checks).toEqual({ finished: false, cut: true })
    expect(computeDimensions(next).parts).toEqual(computeDimensions(job).parts)
  })

  it('メモを変える（部材の変更 updatePart で）', () => {
    const job = bookshelfJob()
    const side = job.parts.find((p) => p.name === '側板')!
    const next = unwrap(updatePart(job, side.id, { memo: '切り出したあとに穴あけ' }))
    expect(next.parts.find((p) => p.id === side.id)!.memo).toBe('切り出したあとに穴あけ')
    expect(side.memo).toBe('')
  })
})

describe('逃げ・材料の一括削除と、材料のサイズの選択（第1.3版 S-09）', () => {
  it('見本で 逃げ0.5・逃げ1 をまとめて消すと逃げが空になり、確認用に［棚板（W）］が返る', () => {
    const job = bookshelfJob()
    expect(nigesUsages(job, ['nige-0.5', 'nige-1'])).toEqual(['棚板（W）'])
    const next = unwrap(removeNiges(job, ['nige-0.5', 'nige-1']))
    expect(next.settings.nige).toEqual([])
    expect(job.settings.nige).toHaveLength(2)
  })

  it('部材が複数の逃げを別の軸で使っていても、部材ごとに1つにまとめる', () => {
    let job = bookshelfJob()
    const tana = job.parts.find((p) => p.name === '棚板')!
    job = unwrap(updatePart(job, tana.id, { expr: { ...tana.expr, D: '全体.D - 20 - {n:nige-0.5}' } }))
    expect(nigesUsages(job, ['nige-0.5', 'nige-1'])).toEqual(['棚板（W・D）'])
  })

  it('シナランバー 18・シナベニヤ 4 をまとめて消すと4部材の材料が未設定になり、確認用に部材名が重ならずに返る', () => {
    const job = bookshelfJob()
    const u = boardsUsages(job, [LUMBER_18_ID, VENEER_4_ID])
    expect(u.cutFrom).toEqual(['側板', '天地板', '棚板', '背板'])
    expect(u.thickness).toEqual([])
    const next = unwrap(removeBoards(job, [LUMBER_18_ID, VENEER_4_ID]))
    expect(next.boards).toEqual([])
    expect(next.parts.filter((p) => p.quantity > 0).every((p) => p.boardId === null)).toBe(true)
  })

  it('無い id が混ざっていても残りは消える。全部無ければ断る', () => {
    const job = bookshelfJob()
    expect(unwrap(removeNiges(job, ['nothing', 'nige-1'])).settings.nige.map((n) => n.id)).toEqual(['nige-0.5'])
    expect(unwrap(removeBoards(job, ['nothing', VENEER_4_ID])).boards.map((b) => b.id)).toEqual([LUMBER_18_ID])
    expect(removeNiges(job, ['nothing']).ok).toBe(false)
    expect(removeBoards(job, ['nothing']).ok).toBe(false)
  })

  it('setBoardSize：4×8 は 1220×2440 長手方向、自由入力 1000×2000 短手方向も選べ、0 以下の寸法は断る', () => {
    const job = bookshelfJob()
    const a = unwrap(setBoardSize(job, LUMBER_18_ID, { sizeKind: 'shihachi', width: 1, length: 1, grain: 'short' }))
    expect(a.boards[0]).toMatchObject({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' })
    const b = unwrap(setBoardSize(job, LUMBER_18_ID, { sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' }))
    expect(b.boards[0]).toMatchObject({ sizeKind: 'custom', width: 1000, length: 2000, grain: 'short' })
    expect(setBoardSize(job, LUMBER_18_ID, { sizeKind: 'custom', width: 0, length: 2000, grain: 'long' }).ok).toBe(false)
    expect(setBoardSize(job, LUMBER_18_ID, { sizeKind: 'custom', width: 1000, length: -1, grain: 'long' }).ok).toBe(false)
    expect(setBoardSize(job, 'nothing', { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' }).ok).toBe(false)
  })
})

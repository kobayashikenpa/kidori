import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { FLUSH_25_ID, flushJob, LAUAN_4_ID, MELAMINE_1_ID } from '../engine/fixtures/flush'
import { expandPieces } from '../engine/packing/pieces'
import type { Job } from '../engine/types'
import { sampleFromTemplate } from './sample'
import { JOBS_KEY, loadSaved, loadTemplate, saveSaved, saveTemplate, type KeyValueStorage } from './storage'
import { defaultTemplate, sameTemplate, templateOf } from './template'
import {
  addFlush,
  copyJob,
  createJob,
  addPart,
  boardsUsages,
  flushesUsages,
  newPart,
  removeBoards,
  removeFlushes,
  setFlushCutCheck,
  updateFlush,
  updatePart,
  type OpResult,
} from './jobs'

function unwrap(r: OpResult): Job {
  if (!r.ok) throw new Error(r.message)
  return r.job
}

const draft = (p: Partial<{ name: string; core: number; faces: { boardId: string; count: number }[] }> = {}) => ({
  name: 'フラッシュ30',
  core: 21,
  faces: [
    { boardId: MELAMINE_1_ID, count: 1 },
    { boardId: LAUAN_4_ID, count: 2 },
  ],
  ...p,
})

describe('フラッシュの追加・変更', () => {
  it('追加すると一覧の最後に入る（名前の前後の空白は外す）', () => {
    const job = unwrap(addFlush(flushJob(), draft({ name: ' フラッシュ30 ' }), 'flush-30'))
    expect(job.flushes.map((f) => [f.id, f.name, f.core])).toEqual([
      [FLUSH_25_ID, 'フラッシュ25', 15],
      ['flush-30', 'フラッシュ30', 21],
    ])
  })

  it('同じ名前（全角・半角の違いだけも）・空の名前は断る', () => {
    expect(addFlush(flushJob(), draft({ name: 'フラッシュ２５' })).ok).toBe(false)
    expect(addFlush(flushJob(), draft({ name: '  ' })).ok).toBe(false)
  })

  it('芯材が 0 以下、表面材が無い・無い材料・枚数が 0 や小数・同じ材料の重ねは断る', () => {
    const job = flushJob()
    expect(addFlush(job, draft({ core: 0 })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [] })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [{ boardId: 'なし', count: 1 }] })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [{ boardId: LAUAN_4_ID, count: 0 }] })).ok).toBe(false)
    expect(addFlush(job, draft({ faces: [{ boardId: LAUAN_4_ID, count: 1.5 }] })).ok).toBe(false)
    const dup = [
      { boardId: LAUAN_4_ID, count: 1 },
      { boardId: LAUAN_4_ID, count: 1 },
    ]
    expect(addFlush(job, draft({ faces: dup })).ok).toBe(false)
  })

  it('変更すると厚みがついてくる（自分と同じ名前は断らない）', () => {
    const job = unwrap(updateFlush(flushJob(), FLUSH_25_ID, draft({ name: 'フラッシュ25', core: 14 })))
    expect(job.flushes[0].core).toBe(14)
    const d = computeDimensions(job).parts[0]
    expect(d.thicknessMismatch).toBe(true) // 14＋1＋8＝23 と 25 は合わない
    expect(updateFlush(flushJob(), 'なし', draft()).ok).toBe(false)
  })
})

describe('フラッシュの削除', () => {
  it('削除の確認：選んでいる部材と、式で厚みを使っている部材', () => {
    let job = flushJob()
    job = unwrap(addPart(job, newPart({ name: '幕板', boardId: LAUAN_4_ID, expr: { W: '900', H: `{t:${FLUSH_25_ID}}`, D: '4' } })))
    expect(flushesUsages(job, [FLUSH_25_ID])).toEqual({ parts: ['天板'], thickness: ['幕板（H）'] })
  })

  it('削除すると使っていた部材は材料が未設定になり、表面材の完了も消える', () => {
    const base = unwrap(setFlushCutCheck(flushJob(), 'part-tenban', MELAMINE_1_ID, true))
    const job = unwrap(removeFlushes(base, [FLUSH_25_ID]))
    expect(job.flushes).toEqual([])
    const p = job.parts[0]
    expect(p.flushId).toBeUndefined()
    expect('flushId' in p).toBe(false)
    expect(p.boardId).toBeNull()
    expect(p.checks).toEqual({ finished: false, cut: false })
    expect(removeFlushes(flushJob(), ['なし']).ok).toBe(false)
  })
})

describe('材料の削除とフラッシュ', () => {
  it('削除の確認に、その材料を表面材に使っているフラッシュが出る', () => {
    expect(boardsUsages(flushJob(), [MELAMINE_1_ID]).flushes).toEqual(['フラッシュ25'])
  })

  it('材料を削除すると、フラッシュの表面材から外れる（厚みは 23 になる）', () => {
    const job = unwrap(removeBoards(flushJob(), [MELAMINE_1_ID]))
    expect(job.flushes[0].faces).toEqual([{ boardId: LAUAN_4_ID, count: 2 }])
  })
})

describe('部材の材料とフラッシュ', () => {
  it('フラッシュを選んだ部材は boardId が null にそろう', () => {
    const job = unwrap(addPart(flushJob(), newPart({ name: '地板', boardId: LAUAN_4_ID, flushId: FLUSH_25_ID })))
    expect(job.parts[1].boardId).toBeNull()
    expect(job.parts[1].flushId).toBe(FLUSH_25_ID)
  })

  it('材料に戻すときは flushId: undefined を渡す（キーごと消える）', () => {
    const job = unwrap(updatePart(flushJob(), 'part-tenban', { flushId: undefined, boardId: LAUAN_4_ID }))
    expect('flushId' in job.parts[0]).toBe(false)
    expect(job.parts[0].boardId).toBe(LAUAN_4_ID)
  })

  it('無いフラッシュは断る', () => {
    expect(updatePart(flushJob(), 'part-tenban', { flushId: 'なし' }).ok).toBe(false)
  })
})

describe('setFlushCutCheck（部材×表面材の完了）', () => {
  it('メラミン1 を完了にすると木取りから メラミン1 だけ除かれる。外すと戻る', () => {
    const job = unwrap(setFlushCutCheck(flushJob(), 'part-tenban', MELAMINE_1_ID, true))
    expect(job.parts[0].checks.cutByBoard).toEqual({ [MELAMINE_1_ID]: true })
    const r = expandPieces(job, computeDimensions(job))
    expect(r.groups.map((g) => [g.board.id, g.pieces.length])).toEqual([[LAUAN_4_ID, 4]])
    const back = unwrap(setFlushCutCheck(job, 'part-tenban', MELAMINE_1_ID, false))
    expect(back.parts[0].checks.cutByBoard).toEqual({})
  })

  it('フラッシュでない部材・表面材でない材料は断る', () => {
    expect(setFlushCutCheck(flushJob(), 'なし', MELAMINE_1_ID, true).ok).toBe(false)
    expect(setFlushCutCheck(flushJob(), 'part-tenban', 'なし', true).ok).toBe(false)
  })
})

function memoryStorage(init: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(init))
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

/** 天板の メラミン1 を完了にし、式でフラッシュの厚みを使う部材も入れた仕事 */
function richJob(): Job {
  let job = unwrap(setFlushCutCheck(flushJob(), 'part-tenban', MELAMINE_1_ID, true))
  job = unwrap(addPart(job, newPart({ id: 'p-maku', name: '幕板', boardId: LAUAN_4_ID, expr: { W: '900', H: `{t:${FLUSH_25_ID}} * 2`, D: '4' } })))
  return job
}

describe('仕事のコピー', () => {
  it('フラッシュ・表面材・部材の flushId・完了・式の {t:…} を新しい id につけ替える', () => {
    const src = richJob()
    const c = copyJob(src, [])
    const f = c.flushes[0]
    expect(f.id).not.toBe(FLUSH_25_ID)
    expect(f.name).toBe('フラッシュ25')
    const [mel, lauan] = c.boards
    expect(f.faces).toEqual([
      { boardId: mel.id, count: 2 },
      { boardId: lauan.id, count: 2 },
    ])
    expect(c.parts[0].flushId).toBe(f.id)
    expect(c.parts[0].boardId).toBeNull()
    expect(c.parts[0].checks.cutByBoard).toEqual({ [mel.id]: true })
    expect(c.parts[1].expr.H).toBe(`{t:${f.id}} * 2`)
    // 寸法・木取りは元と同じ
    expect(computeDimensions(c).parts.map((d) => d.finished)).toEqual(computeDimensions(src).parts.map((d) => d.finished))
    const count = (j: Job) => expandPieces(j, computeDimensions(j)).groups.map((g) => g.pieces.length)
    expect(count(c)).toEqual([5]) // メラミン1 は完了、ラワン4 に天板4枚＋幕板1枚
    expect(count(c)).toEqual(count(src))
    // 元の仕事は変わらない
    expect(src.flushes[0].id).toBe(FLUSH_25_ID)
  })
})

describe('最後に使った設定（ひな形）', () => {
  it('ひな形のフラッシュは表面材を材料名＋厚みで持ち、新しい仕事では新しい材料の id を指す', () => {
    const t = templateOf(flushJob())
    expect(t.flushes).toEqual([
      {
        name: 'フラッシュ25',
        core: 15,
        faces: [
          { material: 'メラミン', thickness: 1, count: 2 },
          { material: 'ラワン', thickness: 4, count: 2 },
        ],
      },
    ])
    const job = createJob('新しい机', t)
    expect(job.flushes).toHaveLength(1)
    expect(job.flushes[0].faces.map((f) => f.boardId)).toEqual(job.boards.map((b) => b.id))
    expect(job.boards.map((b) => b.id)).not.toContain(MELAMINE_1_ID)
  })

  it('フラッシュを変えるとひな形も変わる（sameTemplate が違いを見る）', () => {
    const a = templateOf(flushJob())
    const b = templateOf(unwrap(updateFlush(flushJob(), FLUSH_25_ID, draft({ name: 'フラッシュ25' }))))
    expect(sameTemplate(a, b)).toBe(false)
    expect(sameTemplate(a, templateOf(flushJob()))).toBe(true)
  })

  it('見本にもフラッシュが入る', () => {
    const job = sampleFromTemplate(templateOf(flushJob()))
    expect(job.flushes.map((f) => f.name)).toEqual(['フラッシュ25'])
    const ids = new Set(job.boards.map((b) => b.id))
    expect(job.flushes[0].faces.every((f) => ids.has(f.boardId))).toBe(true)
  })

  it('初期値のひな形・フラッシュの無い以前のひな形はフラッシュなし', () => {
    expect(defaultTemplate().flushes).toEqual([])
    const st = memoryStorage()
    const { flushes: _f, ...old } = defaultTemplate()
    st.setItem('kidori.lastSettings.v1', JSON.stringify({ version: 1, template: old }))
    expect(loadTemplate(st, [])).toEqual(defaultTemplate())
  })

  it('保存したひな形を読み直せる', () => {
    const st = memoryStorage()
    const t = templateOf(flushJob())
    saveTemplate(st, t)
    expect(loadTemplate(st, [])).toEqual(t)
  })
})

describe('保存と読み込み', () => {
  it('第1.4版の形（flushes が無い）の保存データは、フラッシュ [] を足すだけでそのまま読める', () => {
    const { flushes: _f, ...old } = createJob('棚', defaultTemplate(), new Date('2026-01-01'), 'job-old')
    const oldJob = { ...old, parts: [newPart({ id: 'p1', name: '天板', boardId: old.boards[0].id, expr: { W: '900', H: '1', D: '600' } })] }
    const st = memoryStorage({ [JOBS_KEY]: JSON.stringify({ version: 2, jobs: [oldJob] }) })
    const r = loadSaved(st)
    expect(r.status).toBe('ok')
    expect(r.data.jobs).toEqual([{ ...oldJob, flushes: [] }])
  })

  it('フラッシュ・部材の flushId・表面材ごとの完了を保存して読み直せる', () => {
    const job = richJob()
    const st = memoryStorage()
    saveSaved(st, { jobs: [job], currentJobId: job.id })
    const r = loadSaved(st)
    expect(r.status).toBe('ok')
    expect(r.data.jobs).toEqual([job])
  })

  it('無い材料の表面材・無いフラッシュを指す部材・読めないフラッシュは直して読む', () => {
    const job = richJob()
    const bad = {
      ...job,
      flushes: [
        { ...job.flushes[0], faces: [...job.flushes[0].faces, { boardId: 'なし', count: 1 }] },
        { id: 'f-bad', name: '', core: 10, faces: [] },
      ],
      parts: [...job.parts, { ...job.parts[0], id: 'p-x', name: '地板', flushId: 'なし' }],
    }
    const r = loadSaved(memoryStorage({ [JOBS_KEY]: JSON.stringify({ version: 2, jobs: [bad] }) }))
    expect(r.status).toBe('repaired')
    const j = r.data.jobs[0]
    expect(j.flushes).toEqual(job.flushes)
    const x = j.parts.find((p) => p.id === 'p-x')!
    expect('flushId' in x).toBe(false)
    expect(x.boardId).toBeNull()
  })
})

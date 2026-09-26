import { describe, expect, it } from 'vitest'
import { bookshelfJob } from '../engine/fixtures/bookshelf'
import { findSavingHints } from '../engine/hints/saving'
import {
  addBoard,
  addNige,
  addPart,
  createJob,
  newBoard,
  newPart,
  removeBoards,
  removeNiges,
  renameJob,
  updateBoard,
  updatePart,
  updateSettings,
  type JobOp,
} from './jobs'
import { defaultTemplate, templateOf } from './template'
import { applyOp, currentJob, initialState, storeReducer, type StoreState } from './reducer'
import { loadSaved, saveSaved, type KeyValueStorage } from './storage'

const NOW = new Date('2026-09-24T10:00:00.000Z')

/** 画面と同じ流れで操作を当てる（applyOp で1回だけ当てて、結果を reducer に渡す） */
function runOp(s: StoreState, jobId: string, op: JobOp, now: string): StoreState {
  const { action } = applyOp(s, jobId, op, now)
  return action ? storeReducer(s, action) : s
}

/** 見本（本棚 W900）を1つ開いた状態 */
function stateWithSample(): StoreState {
  const t = NOW.toISOString()
  const sample = { ...bookshelfJob(), createdAt: t, updatedAt: t }
  return initialState({ status: 'ok', data: { jobs: [sample], currentJobId: sample.id } })
}

describe('initialState', () => {
  it('読めたが知らせがあるとき（移し替えで寸法が変わった部材）は、知らせを出して保存は続ける', () => {
    const s = initialState({ status: 'ok', data: { jobs: [], currentJobId: null }, message: '以前の版から移したときに寸法が変わった部材：本棚の A' })
    expect(s.loadError).toBe('以前の版から移したときに寸法が変わった部材：本棚の A')
    expect(s.canSave).toBe(true)
  })

  it('何も保存されていなければ、仕事が1つもない空の状態で始める（見本は自動で開かない）', () => {
    const s = initialState({ status: 'empty', data: { jobs: [], currentJobId: null } })
    expect(s.jobs).toEqual([])
    expect(s.currentJobId).toBeNull()
    expect(currentJob(s)).toBeNull()
    expect(s.loadError).toBeNull()
    expect(s.canSave).toBe(true)
  })

  it('読めなかったときは空の一覧で、知らせを持つ', () => {
    const s = initialState({
      status: 'error',
      data: { jobs: [], currentJobId: null },
      message: '保存データを読めませんでした',
      canSave: false,
    })
    expect(s.jobs).toEqual([])
    expect(s.loadError).toBe('保存データを読めませんでした')
    expect(s.canSave).toBe(false)
  })

  it('読めたときはその内容で始める', () => {
    const job = bookshelfJob()
    const s = initialState({ status: 'ok', data: { jobs: [job], currentJobId: null } })
    expect(s.jobs).toEqual([job])
    expect(currentJob(s)).toBeNull()
  })
})

describe('storeReducer', () => {
  it('操作を当てると仕事が変わり、更新日時が進む', () => {
    const s0 = stateWithSample()
    const id = s0.currentJobId!
    const s1 = runOp(s0, id, (j) => updatePart(j, 'part-zentai', { expr: { W: '1000', H: '1800', D: '400' } }), '2026-09-24T11:00:00.000Z')
    expect(currentJob(s1)?.parts[0].expr.W).toBe('1000')
    expect(currentJob(s1)?.updatedAt).toBe('2026-09-24T11:00:00.000Z')
    expect(currentJob(s0)?.parts[0].expr.W).toBe('900')
  })

  it('失敗する操作は何も変えない', () => {
    const s0 = stateWithSample()
    const { result, action } = applyOp(s0, s0.currentJobId!, (j) => updateSettings(j, { kerf: -1 }), 'x')
    expect(result.ok).toBe(false)
    expect(action).toBeNull()
    expect(runOp(s0, s0.currentJobId!, (j) => updateSettings(j, { kerf: -1 }), 'x')).toBe(s0)
  })

  it('仕事を足して開く・開き直す', () => {
    const s0 = stateWithSample()
    const job = createJob('食器棚')
    const s1 = storeReducer(s0, { type: 'addJob', job, open: true })
    expect(s1.jobs).toHaveLength(2)
    expect(currentJob(s1)?.name).toBe('食器棚')
    const s2 = storeReducer(s1, { type: 'openJob', id: s0.currentJobId })
    expect(currentJob(s2)?.name).toBe('本棚 W900')
  })

  it('無い仕事は開かない', () => {
    const s0 = stateWithSample()
    expect(storeReducer(s0, { type: 'openJob', id: 'nothing' })).toBe(s0)
  })
})

describe('removeJob', () => {
  it('開いていた仕事を消すと、何も開いていない状態になる', () => {
    const s0 = stateWithSample()
    const other = createJob('食器棚', undefined, NOW, 'job-other')
    const s1 = storeReducer(s0, { type: 'addJob', job: other, open: false })
    const s2 = storeReducer(s1, { type: 'removeJob', id: s0.currentJobId! })
    expect(s2.jobs.map((j) => j.id)).toEqual(['job-other'])
    expect(s2.currentJobId).toBeNull()
  })

  it('開いていない仕事を消しても、開いている仕事はそのまま', () => {
    const s0 = stateWithSample()
    const other = createJob('食器棚', undefined, NOW, 'job-other')
    const s1 = storeReducer(s0, { type: 'addJob', job: other, open: false })
    const s2 = storeReducer(s1, { type: 'removeJob', id: 'job-other' })
    expect(s2.currentJobId).toBe(s0.currentJobId)
    expect(s2.jobs).toHaveLength(1)
  })
})

describe('設定の変更とお知らせ（第1.2版 U-22）', () => {
  /** 初期の材料の仕事で、ラワン4 W602 H1200 D4（木目 H）×4枚・部材の切り代は空欄・仕事の切り代 0 */
  function stateWithRawan(): StoreState {
    const r = updateSettings(createJob('お知らせ', undefined, NOW, 'job-h'), { allowance: 0, trim: 5, kerf: 3 })
    if (!r.ok) throw new Error(r.message)
    let job = r.job
    const rawan4 = job.boards.find((b) => b.material === 'ラワン' && b.thickness === 4)!
    job = { ...job, parts: [newPart({ name: '棚', boardId: rawan4.id, expr: { W: '602', H: '1200', D: '4' }, quantity: 4, grain: 'H' })] }
    return initialState({ status: 'ok', data: { jobs: [job], currentJobId: job.id } })
  }
  const apply = (s: StoreState, allowance: number) =>
    runOp(s, 'job-h', (j) => updateSettings(j, { allowance }), NOW.toISOString())

  it('切り代を 0 → 5 → 0 と変えるたびに新しい仕事になり、お知らせがすぐ変わる', () => {
    const s0 = stateWithRawan()
    const j0 = currentJob(s0)!
    expect(findSavingHints(j0)).toEqual([])

    const s5 = apply(s0, 5)
    const j5 = currentJob(s5)!
    expect(j5).not.toBe(j0)
    expect(j5.settings).not.toBe(j0.settings)
    expect(j5.settings.allowance).toBe(5)
    expect(findSavingHints(j5).map((h) => h.message)).toEqual(['切り代を 4mm にすると、ラワン 4mm が 1 枚減ります（2枚 → 1枚）'])

    const back = currentJob(apply(s5, 0))!
    expect(back).not.toBe(j5)
    expect(findSavingHints(back)).toEqual([])
  })
})

describe('足した逃げ・材料を消す（第1.3版 U-28 の不具合の再発防止）', () => {
  function memoryStorage(): KeyValueStorage {
    const map = new Map<string, string>()
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
  }

  /**
   * JobStore と同じ持ち方：手元の状態（latest）と React の状態を別々に持ち、
   * React 側は同じアクションで reducer を2回呼ぶ（StrictMode と同じ）
   */
  function storeFlow(s0: StoreState) {
    let latest = s0
    let react = s0
    const run = (op: JobOp) => {
      const { result, action } = applyOp(latest, latest.currentJobId!, op, NOW.toISOString())
      if (action) {
        latest = storeReducer(latest, action)
        storeReducer(react, action)
        react = storeReducer(react, action)
      }
      return result
    }
    return { run, latest: () => latest, react: () => react }
  }

  it('逃げ2 を足してすぐ消すと、画面に出ている逃げが消え、保存して読み込んでも戻らない', () => {
    const f = storeFlow(stateWithSample())
    expect(f.run((j) => addNige(j, 2)).ok).toBe(true)
    const shown = currentJob(f.react())!.settings.nige.find((n) => n.value === 2)!
    expect(shown).toBeDefined()
    // 画面に出ている id（React の状態）と手元の状態の id が同じ
    expect(currentJob(f.latest())!.settings.nige.find((n) => n.value === 2)!.id).toBe(shown.id)
    const r = f.run((j) => removeNiges(j, [shown.id]))
    expect(r.ok).toBe(true)
    expect(currentJob(f.react())!.settings.nige.map((n) => n.value)).toEqual([0.5, 1])

    const st = memoryStorage()
    expect(saveSaved(st, { jobs: f.react().jobs, currentJobId: f.react().currentJobId }).ok).toBe(true)
    const loaded = loadSaved(st)
    expect(loaded.status).toBe('ok')
    const job = loaded.data.jobs.find((j) => j.id === f.react().currentJobId)!
    expect(job.settings.nige.map((n) => n.value)).toEqual([0.5, 1])
  })

  it('初期の 逃げ0.5 も同じく消せる', () => {
    const f = storeFlow(stateWithSample())
    const id = currentJob(f.react())!.settings.nige.find((n) => n.value === 0.5)!.id
    expect(f.run((j) => removeNiges(j, [id])).ok).toBe(true)
    expect(currentJob(f.react())!.settings.nige.map((n) => n.value)).toEqual([1])
  })

  it('足した材料をすぐ消すと消え、保存して読み込んでも戻らない', () => {
    const f = storeFlow(stateWithSample())
    const before = currentJob(f.react())!.boards.length
    expect(f.run((j) => addBoard(j, newBoard({ material: 'シナ', thickness: 21 }))).ok).toBe(true)
    const shown = currentJob(f.react())!.boards.find((b) => b.material === 'シナ' && b.thickness === 21)!
    expect(f.run((j) => removeBoards(j, [shown.id])).ok).toBe(true)
    expect(currentJob(f.react())!.boards).toHaveLength(before)

    const st = memoryStorage()
    saveSaved(st, { jobs: f.react().jobs, currentJobId: f.react().currentJobId })
    const job = loadSaved(st).data.jobs.find((j) => j.id === f.react().currentJobId)!
    expect(job.boards.some((b) => b.material === 'シナ' && b.thickness === 21)).toBe(false)
  })
})

describe('最後に使った設定（ひな形）の更新（第1.3版 S-08）', () => {
  /** 仕事 A・B（どちらも初期値）がある状態。A を開いている */
  function twoJobs(): StoreState {
    const a = createJob('A', undefined, NOW, 'job-a')
    const b = createJob('B', undefined, NOW, 'job-b')
    return initialState({ status: 'ok', data: { jobs: [a, b], currentJobId: 'job-a' } })
  }
  const t = NOW.toISOString()

  it('仕事 A で刃厚を 2 にするとひな形の刃厚が 2、そのあと B で逃げ3 を足すとひな形は B の設定', () => {
    const s0 = twoJobs()
    expect(s0.template).toEqual(defaultTemplate())
    const s1 = runOp(s0, 'job-a', (j) => updateSettings(j, { kerf: 2 }), t)
    expect(s1.template.settings.kerf).toBe(2)
    const s2 = runOp(s1, 'job-b', (j) => addNige(j, 3, 'nige-3'), t)
    expect(s2.template.settings.kerf).toBe(3)
    expect(s2.template.settings.nige.map((n) => n.value)).toEqual([0.5, 1, 3])
    expect(s2.template).toEqual(templateOf(s2.jobs.find((j) => j.id === 'job-b')!))
  })

  it('材料の追加・削除でもひな形が変わる', () => {
    const s0 = twoJobs()
    const s1 = runOp(s0, 'job-a', (j) => addBoard(j, newBoard({ material: 'シナ', thickness: 18 })), t)
    expect(s1.template.materials.map((m) => m.material)).toContain('シナ')
    const id = currentJob(s1)!.boards.find((b) => b.material === 'シナ')!.id
    const s2 = runOp(s1, 'job-a', (j) => removeBoards(j, [id]), t)
    expect(s2.template.materials.map((m) => m.material)).not.toContain('シナ')
  })

  it('部材の変更・材料のサイズの選択・名前の変更・仕事の追加や削除ではひな形が変わらない', () => {
    let s = runOp(twoJobs(), 'job-a', (j) => updateSettings(j, { kerf: 2 }), t)
    const tpl = s.template
    s = runOp(s, 'job-a', (j) => addPart(j, newPart({ name: '天板', expr: { W: '900', H: '18', D: '600' } })), t)
    const rawan = currentJob(s)!.boards[1].id
    s = runOp(s, 'job-a', (j) => updateBoard(j, rawan, { sizeKind: 'saburoku' }), t)
    expect(currentJob(s)!.boards[1].sizeKind).toBe('saburoku')
    s = runOp(s, 'job-a', (j) => renameJob(j, '別の名前'), t)
    s = storeReducer(s, { type: 'addJob', job: createJob('C', undefined, NOW, 'job-c'), open: false })
    s = storeReducer(s, { type: 'removeJob', id: 'job-b' })
    expect(s.template).toBe(tpl)
  })
})

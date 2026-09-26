import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../engine/defaults'
import { bookshelfJob, VENEER_4_ID } from '../engine/fixtures/bookshelf'
import { computeDimensions } from '../engine/dimensions'
import {
  BROKEN_BACKUP_INDEX_KEY,
  BROKEN_BACKUP_KEY,
  CURRENT_JOB_KEY,
  JOBS_KEY,
  LEGACY_JOBS_KEY,
  MAX_BACKUPS,
  loadSaved,
  saveSaved,
  type KeyValueStorage,
} from './storage'

function memoryStorage(init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

/** 退避したデータ（キーが退避の頭で始まり、一覧のキーでないもの） */
function backups(s: { map: Map<string, string> }): string[] {
  return [...s.map.keys()].filter((k) => k.startsWith(`${BROKEN_BACKUP_KEY}.`) && k !== BROKEN_BACKUP_INDEX_KEY).sort()
}

const T1 = new Date('2026-09-25T01:00:00.000Z')

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('保存と読み込み', () => {
  it('見本を保存して読み込むと同じ内容に戻る', () => {
    const s = memoryStorage()
    const job = bookshelfJob()
    expect(saveSaved(s, { jobs: [job], currentJobId: job.id })).toEqual({ ok: true })
    const r = loadSaved(s)
    expect(r.status).toBe('ok')
    expect(r.data).toEqual({ jobs: [bookshelfJob()], currentJobId: job.id })
  })

  it('何も保存されていなければ empty', () => {
    expect(loadSaved(memoryStorage())).toEqual({ status: 'empty', data: { jobs: [], currentJobId: null } })
  })

  it('開いている仕事の id が一覧に無ければ null にする', () => {
    const s = memoryStorage()
    saveSaved(s, { jobs: [bookshelfJob()], currentJobId: 'nothing' })
    expect(loadSaved(s).data.currentJobId).toBeNull()
  })

  it('localStorage が例外を投げても落ちずに、空の一覧とエラーの印を返す', () => {
    const r = loadSaved(throwing)
    expect(r.status).toBe('error')
    expect(r.data.jobs).toEqual([])
    if (r.status === 'error') expect(r.canSave).toBe(false)
    expect(saveSaved(throwing, { jobs: [], currentJobId: null }).ok).toBe(false)
  })

  it('localStorage が無い環境でも落ちない', () => {
    expect(loadSaved(null).status).toBe('error')
    expect(saveSaved(null, { jobs: [], currentJobId: null }).ok).toBe(false)
  })

  it('壊れた JSON は読まずにエラーの印を返し、元のデータを退避して上書きしない', () => {
    const s = memoryStorage({ [JOBS_KEY]: '{"version":2,"jobs":[', [CURRENT_JOB_KEY]: 'x' })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('error')
    expect(r.data).toEqual({ jobs: [], currentJobId: null })
    expect(s.map.get(JOBS_KEY)).toBe('{"version":2,"jobs":[')
    expect(s.map.get(`${BROKEN_BACKUP_KEY}.2026-09-25T01:00:00.000Z`)).toBe('{"version":2,"jobs":[')
    if (r.status === 'error') expect(r.canSave).toBe(true)
  })

  it('形の違うデータ（版が違う・仕事の形でない）もエラーにする', () => {
    expect(loadSaved(memoryStorage({ [JOBS_KEY]: '{"version":1,"jobs":[]}' })).status).toBe('error')
    expect(loadSaved(memoryStorage({ [JOBS_KEY]: '{"version":3,"jobs":[]}' })).status).toBe('error')
    expect(loadSaved(memoryStorage({ [JOBS_KEY]: 'null' })).status).toBe('error')
  })

  it('壊れたデータを退避できないときは、保存してはいけない印を返す', () => {
    const map = new Map([[JOBS_KEY, 'broken']])
    const s: KeyValueStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    const r = loadSaved(s)
    expect(r.status === 'error' && r.canSave).toBe(false)
  })
})

/** 見本を1件保存したデータを JSON のまま少し書き換えて入れる */
function storedWith(edit: (job: Record<string, any>) => void, extraJobs: unknown[] = []) {
  const job = JSON.parse(JSON.stringify(bookshelfJob()))
  edit(job)
  return memoryStorage({
    [JOBS_KEY]: JSON.stringify({ version: 2, jobs: [job, ...extraJobs] }),
    [CURRENT_JOB_KEY]: job.id,
  })
}

describe('中身の検査と修復', () => {
  it('正しいデータは直さずに ok で読み、退避もしない', () => {
    const s = storedWith(() => {})
    expect(loadSaved(s, T1).status).toBe('ok')
    expect(backups(s)).toEqual([])
  })

  it('仕事の形でないもの・id の無い仕事・同じ id の仕事は外し、ほかの仕事は残す', () => {
    const s = storedWith(() => {}, [{ id: 1 }, null, 'x', { name: 'id なし' }, { ...bookshelfJob(), name: '同じ id' }])
    const r = loadSaved(s, T1)
    expect(r.status).toBe('repaired')
    expect(r.data.jobs.map((j) => j.name)).toEqual(['本棚 W900'])
    expect(r.data.currentJobId).toBe(bookshelfJob().id)
    if (r.status === 'repaired') expect(r.canSave).toBe(true)
    // 元のデータは退避してあり、元のキーもまだ書き換えていない
    expect(backups(s)).toHaveLength(1)
    expect(s.map.get(backups(s)[0]!)).toBe(s.map.get(JOBS_KEY))
  })

  it('仕事の配列が全部読めなくても、空の一覧で画面を出せる', () => {
    const r = loadSaved(memoryStorage({ [JOBS_KEY]: '{"version":2,"jobs":[{"id":1}]}' }), T1)
    expect(r.status).toBe('repaired')
    expect(r.data.jobs).toEqual([])
  })

  it('設定のおかしな値は初期値に直し、正しい値は残す', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.settings = { kerf: 4, trim: -1, allowance: 'x', cutMode: 'diagonal' }
      }),
      T1,
    )
    expect(r.status).toBe('repaired')
    expect(r.data.jobs[0]!.settings).toEqual({ ...defaultSettings(), kerf: 4 })
  })

  it('設定・板・部材が無い仕事も、空として読む', () => {
    const r = loadSaved(
      storedWith((j) => {
        delete j.settings
        delete j.boards
        j.parts = 'x'
      }),
      T1,
    )
    const job = r.data.jobs[0]!
    expect(job.settings).toEqual(defaultSettings())
    expect(job.boards).toEqual([])
    expect(job.parts).toEqual([])
  })

  it('読めない板を外し、その板を使っていた部材は板が未設定になる。ほかの板・部材は残す', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.boards[0].thickness = 'abc'
      }),
      T1,
    )
    const job = r.data.jobs[0]!
    expect(job.boards.map((b) => b.id)).toEqual([VENEER_4_ID])
    expect(job.parts.filter((p) => p.boardId === null).map((p) => p.name)).toEqual(
      expect.arrayContaining(['側板', '天地板', '棚板']),
    )
    expect(job.parts).toHaveLength(bookshelfJob().parts.length)
  })

  it('短辺と長辺が逆の板は入れ替えて直す', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.boards[0].width = 1820
        j.boards[0].length = 910
      }),
      T1,
    )
    expect(r.status).toBe('repaired')
    const b = r.data.jobs[0]!.boards[0]!
    expect([b.width, b.length]).toEqual([910, 1820])
  })

  it('材料名＋厚みが同じ板が2つあれば、後の板を外す', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.boards.push({ ...j.boards[0], id: 'board-dup' })
      }),
      T1,
    )
    expect(r.data.jobs[0]!.boards).toHaveLength(2)
  })

  it('id・名前の無い部材、同じ名前の部材は外し、ほかの部材は残す', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.parts.push({ id: 'p-x' }, { name: '名前だけ' }, { ...j.parts[1], id: 'p-dup' }, 42)
      }),
      T1,
    )
    expect(r.status).toBe('repaired')
    expect(r.data.jobs[0]!.parts.map((p) => p.name)).toEqual(bookshelfJob().parts.map((p) => p.name))
  })

  it('部材のおかしな値は直し、寸法の計算まで落ちずにできる', () => {
    const r = loadSaved(
      storedWith((j) => {
        const p = j.parts[1]
        p.expr = { W: 18, H: null }
        p.quantity = -2
        p.grain = 'X'
        p.thicknessAxis = 'Z'
        p.allowance = 'x'
        p.boardId = 'board-none'
      }),
      T1,
    )
    const p = r.data.jobs[0]!.parts[1]!
    expect(p.expr).toEqual({ W: '18', H: '', D: '' })
    expect(p.quantity).toBe(1)
    expect(p.grain).toBe('any')
    expect(p.thicknessAxis).toBeNull()
    expect(p.allowance).toBeNull()
    expect(p.boardId).toBeNull()
    expect(() => computeDimensions(r.data.jobs[0]!)).not.toThrow()
  })

  it('名前・日時が読めない仕事も読む', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.name = ''
        j.createdAt = 5
        j.updatedAt = 'not a date'
      }),
      T1,
    )
    const job = r.data.jobs[0]!
    expect(job.name).toBe('名前のない仕事')
    expect(Number.isNaN(Date.parse(job.updatedAt))).toBe(false)
    expect(Number.isNaN(Date.parse(job.createdAt))).toBe(false)
  })
})

describe('読めなかったデータの退避', () => {
  it('前の退避を上書きせず、新しいものから3つだけ残す', () => {
    const s = memoryStorage()
    const times = ['01', '02', '03', '04'].map((h) => new Date(`2026-09-25T${h}:00:00.000Z`))
    times.forEach((t, i) => {
      s.map.set(JOBS_KEY, `broken-${i}`)
      expect(loadSaved(s, t).status).toBe('error')
    })
    expect(MAX_BACKUPS).toBe(3)
    const keys = backups(s)
    expect(keys).toHaveLength(3)
    expect(keys.map((k) => s.map.get(k))).toEqual(['broken-1', 'broken-2', 'broken-3'])
    expect(JSON.parse(s.map.get(BROKEN_BACKUP_INDEX_KEY)!)).toEqual(keys)
  })

  it('同じ中身は2回退避しない', () => {
    const s = memoryStorage({ [JOBS_KEY]: 'a' })
    loadSaved(s, T1)
    const r = loadSaved(s, new Date('2026-09-25T02:00:00.000Z'))
    expect(r.status === 'error' && r.canSave).toBe(true)
    expect(backups(s)).toHaveLength(1)
  })

  it('同じ時刻に2回退避しても、別のキーになる', () => {
    const s = memoryStorage({ [JOBS_KEY]: 'a' })
    loadSaved(s, T1)
    s.map.set(JOBS_KEY, 'b')
    loadSaved(s, T1)
    expect(backups(s).map((k) => s.map.get(k))).toEqual(['a', 'b'])
  })

  it('前の版の退避キー（日時なし）は消さない', () => {
    const s = memoryStorage({ [BROKEN_BACKUP_KEY]: 'old', [JOBS_KEY]: 'x' })
    loadSaved(s, T1)
    expect(s.map.get(BROKEN_BACKUP_KEY)).toBe('old')
  })

  it('退避の一覧が壊れていても退避できる', () => {
    const s = memoryStorage({ [BROKEN_BACKUP_INDEX_KEY]: '{', [JOBS_KEY]: 'x' })
    const r = loadSaved(s, T1)
    expect(r.status === 'error' && r.canSave).toBe(true)
    expect(backups(s)).toHaveLength(1)
  })

  it('退避キーがいつまでも空かなければ、あきらめて保存しない', () => {
    let calls = 0
    const s: KeyValueStorage = {
      getItem: (k) => {
        calls++
        return k === JOBS_KEY ? 'broken' : k === BROKEN_BACKUP_INDEX_KEY ? null : 'ほかのデータ'
      },
      setItem: () => {},
      removeItem: () => {},
    }
    const r = loadSaved(s, T1)
    expect(r.status === 'error' && !r.canSave).toBe(true)
    expect(calls).toBeLessThan(200)
  })
})

/** 以前の版（第1版）の形の見本：設定に逃げが無く、棚板は W = 天地板.W・部材ごとの逃げ W1、メモ・チェックなし */
function legacyBookshelf(): Record<string, any> {
  const job = JSON.parse(JSON.stringify(bookshelfJob()))
  delete job.settings.nige
  for (const p of job.parts) {
    delete p.memo
    delete p.checks
    p.clearance = {}
  }
  const shelf = job.parts.find((p: any) => p.name === '棚板')
  shelf.expr.W = '天地板.W'
  shelf.clearance = { W: 1 }
  return job
}

describe('保存データ第2版と、以前の版からの移し替え', () => {
  it('第1版の見本を読むと、棚板の式が 天地板.W - 逃げ1mm になり、仕上がり 863 のまま', () => {
    const legacy = legacyBookshelf()
    const v1 = JSON.stringify({ version: 1, jobs: [legacy] })
    const s = memoryStorage({ [LEGACY_JOBS_KEY]: v1, [CURRENT_JOB_KEY]: legacy.id })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('ok')
    const job = r.data.jobs[0]!
    expect(r.data.currentJobId).toBe(legacy.id)
    expect(job.settings.nige).toEqual(defaultSettings().nige)
    const shelf = job.parts.find((p) => p.name === '棚板')!
    expect(shelf.expr.W).toBe('天地板.W - {n:nige-1}')
    expect(shelf).not.toHaveProperty('clearance')
    expect(shelf.memo).toBe('')
    expect(shelf.checks).toEqual({ finished: false, cut: false })
    const dims = computeDimensions(job)
    expect(dims.errors).toEqual([])
    expect(dims.parts.find((d) => d.name === '棚板')!.finished).toEqual({ W: 863, H: 18, D: 380 })
    // 見本と同じ寸法になる
    const strip = (j: typeof job) => computeDimensions(j).parts.map((d) => [d.name, d.finished, d.cutSize])
    expect(strip(job)).toEqual(strip(bookshelfJob()))

    // 保存すると第2版に書かれ、第1版は元のまま残る
    expect(saveSaved(s, r.data)).toEqual({ ok: true })
    expect(s.map.get(LEGACY_JOBS_KEY)).toBe(v1)
    expect(JSON.parse(s.map.get(JOBS_KEY)!).version).toBe(2)
    const again = loadSaved(s, T1)
    expect(again.status).toBe('ok')
    expect(again.data).toEqual(r.data)
  })

  it('第2版があれば第1版は読まない', () => {
    const s = memoryStorage({
      [JOBS_KEY]: JSON.stringify({ version: 2, jobs: [] }),
      [LEGACY_JOBS_KEY]: JSON.stringify({ version: 1, jobs: [legacyBookshelf()] }),
    })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('ok')
    expect(r.data.jobs).toEqual([])
  })

  it('第1版が壊れていてもエラーの印で返し、第1版は書き換えない', () => {
    const s = memoryStorage({ [LEGACY_JOBS_KEY]: '{' })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('error')
    expect(s.map.get(LEGACY_JOBS_KEY)).toBe('{')
  })

  it('第2版の見本を保存して読み込むと同じ内容に戻る（逃げ・メモ・チェックも）', () => {
    const s = memoryStorage()
    const job = bookshelfJob()
    job.parts[1]!.memo = '穴あけ'
    job.parts[1]!.checks = { finished: true, cut: false }
    job.settings.nige.push({ id: 'nige-x', value: 2 })
    saveSaved(s, { jobs: [job], currentJobId: job.id })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual(job)
  })

  it('逃げの値が 0・負・重複しているもの、id が重複しているものは外して repaired で読む', () => {
    const r = loadSaved(
      storedWith((j) => {
        j.settings.nige = [
          { id: 'nige-0.5', value: 0.5 },
          { id: 'a', value: 0 },
          { id: 'b', value: -1 },
          { id: 'c', value: 0.5 },
          { id: 'nige-0.5', value: 3 },
          { id: '', value: 4 },
          { id: 'nige-1', value: 1 },
        ]
      }),
      T1,
    )
    expect(r.status).toBe('repaired')
    expect(r.data.jobs[0]!.settings.nige).toEqual(defaultSettings().nige)
  })

  it('第2版で逃げ・メモ・チェックが無ければ初期値にして repaired で読む', () => {
    const r = loadSaved(
      storedWith((j) => {
        delete j.settings.nige
        delete j.parts[0].memo
        j.parts[1].checks = 'x'
      }),
      T1,
    )
    expect(r.status).toBe('repaired')
    const job = r.data.jobs[0]!
    expect(job.settings.nige).toEqual(defaultSettings().nige)
    expect(job.parts[0]!.memo).toBe('')
    expect(job.parts[1]!.checks).toEqual({ finished: false, cut: false })
  })

  it('第2版に部材ごとの逃げが残っていても、移し替えて寸法が変わらない', () => {
    const r = loadSaved(storedWith((j) => Object.assign(j, legacyBookshelf(), { settings: bookshelfJob().settings })), T1)
    const job = r.data.jobs[0]!
    expect(job.parts.find((p) => p.name === '棚板')!.expr.W).toBe('天地板.W - {n:nige-1}')
    expect(computeDimensions(job).parts.find((d) => d.name === '棚板')!.finished?.W).toBe(863)
  })

  it('移し替えで寸法が変わった部材があれば、ok のまま部材名を知らせる（以前は厚みの判定の循環でエラーだった P）', () => {
    const legacy = legacyBookshelf()
    legacy.parts = [
      ...legacy.parts,
      { ...legacy.parts[1], id: 'p', name: 'P', expr: { W: 'Q.W', H: '18', D: '600' }, clearance: { H: 1 }, quantity: 1 },
      { ...legacy.parts[1], id: 'q', name: 'Q', expr: { W: 'P.H', H: '18', D: '100' }, clearance: {}, quantity: 0, boardId: null },
    ]
    const s = memoryStorage({ [LEGACY_JOBS_KEY]: JSON.stringify({ version: 1, jobs: [legacy] }) })
    const r = loadSaved(s, T1)
    expect(r.status).toBe('ok')
    expect(r.status === 'ok' && r.message).toBe(`以前の版から移したときに寸法が変わった部材：${legacy.name}の P・Q（寸法表で確かめてください）`)
  })

  it('以前は厚みが決まらなかった部材が、仕上がり寸法は同じまま今は決まるだけなら知らせない', () => {
    const legacy = legacyBookshelf()
    legacy.parts = [
      ...legacy.parts,
      { ...legacy.parts[1], id: 'a', name: 'A', expr: { W: '400', H: '19', D: '300' }, clearance: { H: 1 }, quantity: 1 },
      { ...legacy.parts[1], id: 'b', name: 'B', expr: { W: 'A.H', H: '500', D: '300' }, clearance: { W: 1 }, quantity: 1 },
    ]
    const s = memoryStorage({ [LEGACY_JOBS_KEY]: JSON.stringify({ version: 1, jobs: [legacy] }) })
    const r = loadSaved(s, T1)
    expect(r.status === 'ok' && r.message).toBeFalsy()
  })

  it('寸法の変わらない移し替えでは知らせない', () => {
    const s = memoryStorage({ [LEGACY_JOBS_KEY]: JSON.stringify({ version: 1, jobs: [legacyBookshelf()] }) })
    const r = loadSaved(s, T1)
    expect(r.status === 'ok' && r.message).toBeFalsy()
  })

  it('移し替えで足した逃げ 0.25 と 0.3 は、保存して読み直しても両方残る（同じ値だけを重なりとみなす）', () => {
    const legacy = legacyBookshelf()
    legacy.parts.find((p: any) => p.name === '側板').clearance = { D: 0.25 }
    legacy.parts.find((p: any) => p.name === '背板').clearance = { W: 0.3 }
    const s = memoryStorage({ [LEGACY_JOBS_KEY]: JSON.stringify({ version: 1, jobs: [legacy] }) })
    const r = loadSaved(s, T1)
    expect(r.data.jobs[0]!.settings.nige.map((n) => n.value)).toEqual([0.5, 1, 0.25, 0.3])
    saveSaved(s, r.data)
    const again = loadSaved(s, T1)
    expect(again.status).toBe('ok')
    expect(again.data).toEqual(r.data)
  })
})


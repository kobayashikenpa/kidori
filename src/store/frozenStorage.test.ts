// 第1.8版：固定した1枚の保存・読み込みの検査、コピー・材料の削除、以前の木取り済みを外す操作（S-16）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../engine/dimensions'
import { bookshelfJob, LUMBER_18_ID, VENEER_4_ID } from '../engine/fixtures/bookshelf'
import { packJob } from '../engine/packing'
import type { FrozenSheet, Job } from '../engine/types'
import { clearLegacyCut, copyJob, removeBoards, setPieceCheck, type OpResult } from './jobs'
import { sampleFromTemplate } from './sample'
import { CURRENT_JOB_KEY, JOBS_KEY, loadSaved, saveSaved, type KeyValueStorage } from './storage'
import { defaultTemplate } from './template'

const NOW = new Date('2026-09-27T09:00:00.000Z')

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
const ok = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const pack = (job: Job) => packJob(job, computeDimensions(job))

/** ランバーの1枚目（側板×2）を1つチェック、ベニヤの1枚目（背板）を切り終わりにした仕事 */
function frozenJob(): Job {
  let job = bookshelfJob()
  const r = pack(job)
  for (const m of r.materials) {
    const layout = m.sheets[0]
    const t = { kind: 'computed', boardId: m.boardId, mode: m.mode, layout } as const
    job = ok(setPieceCheck(job, t, layout.placements[0].pieceId, true, NOW, `sheet-${m.boardId}`))
  }
  return job
}

function stored(jobs: unknown[]) {
  return memoryStorage({ [JOBS_KEY]: JSON.stringify({ version: 2, jobs }), [CURRENT_JOB_KEY]: 'job-bookshelf-w900' })
}
/** 保存データの仕事（JSON）の固定した1枚を書き換えて読む */
function loadEdited(edit: (sheets: any[]) => unknown, replace?: unknown) {
  const raw = JSON.parse(JSON.stringify(frozenJob()))
  edit(raw.frozenSheets)
  if (replace !== undefined) raw.frozenSheets = replace
  return loadSaved(stored([raw]), NOW)
}
const sheetsOf = (r: ReturnType<typeof loadSaved>): FrozenSheet[] => r.data.jobs[0].frozenSheets

describe('読み込み（sanitizeJob）の frozenSheets', () => {
  it('第1.7版のデータ（frozenSheets なし）は [] で、直した数に数えない。以前の checks.cut・cutByBoard はそのまま', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) =>
      p.name === '棚板' ? { ...p, checks: { finished: true, cut: true } } : p,
    )
    const raw = JSON.parse(JSON.stringify(job))
    delete raw.frozenSheets
    const r = loadSaved(stored([raw]), NOW)
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual({ ...job, frozenSheets: [] })
  })

  it('第1.7版の見本（フラッシュの表面材ごとの完了 cutByBoard あり、frozenSheets なし）も失わずに読む', () => {
    const job0 = sampleFromTemplate(defaultTemplate(), NOW)
    const mel = job0.boards.find((b) => b.material === 'メラミン')!.id
    const job = {
      ...job0,
      parts: job0.parts.map((p) => (p.name === '棚板' ? { ...p, checks: { ...p.checks, cutByBoard: { [mel]: true } } } : p)),
    }
    const raw = JSON.parse(JSON.stringify(job))
    delete raw.frozenSheets
    const r = loadSaved(memoryStorage({ [JOBS_KEY]: JSON.stringify({ version: 2, jobs: [raw] }) }), NOW)
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual(job)
  })

  it('保存して読み込むと同じ中身（切り終わりを含む）', () => {
    const job = frozenJob()
    expect(job.frozenSheets.map((f) => [f.checked.length, f.completedAt !== undefined])).toEqual([
      [1, false],
      [1, true],
    ])
    const s = memoryStorage()
    expect(saveSaved(s, { jobs: [job], currentJobId: job.id }).ok).toBe(true)
    const r = loadSaved(s, NOW)
    expect(r.status).toBe('ok')
    expect(r.data.jobs[0]).toEqual(job)
  })

  it('frozenSheets が配列でなければ [] にして直した数に数える', () => {
    const r = loadEdited(() => {}, 'x')
    expect(r.status).toBe('repaired')
    expect(sheetsOf(r)).toEqual([])
  })

  it('写しに無い pieceId・重複は外す（直した数に数える）', () => {
    const r = loadEdited((s) => {
      s[0].checked = [s[0].checked[0], 'none#1', s[0].checked[0], 3]
    })
    expect(r.status).toBe('repaired')
    expect(sheetsOf(r)[0].checked).toEqual(frozenJob().frozenSheets[0].checked)
    expect(sheetsOf(r)).toHaveLength(2)
  })

  it('チェックが空になった1枚は外す', () => {
    for (const checked of [['none#1'], [], undefined]) {
      const r = loadEdited((s) => {
        s[0].checked = checked
      })
      expect(r.status).toBe('repaired')
      expect(sheetsOf(r).map((f) => f.id)).toEqual([`sheet-${VENEER_4_ID}`])
    }
  })

  it('形の壊れた1枚は外す：id なし・id の重複・boardId が文字でない・mode が縦／横でない・layout の数が数でない・placements が空・片の形が壊れている', () => {
    const edits: ((s: any[]) => void)[] = [
      (s) => delete s[0].id,
      (s) => (s[0].id = s[1].id),
      (s) => (s[0].boardId = 1),
      (s) => (s[0].mode = 'auto'),
      (s) => (s[0].layout.boardWidth = '910'),
      (s) => (s[0].layout.usable.w = null),
      (s) => (s[0].layout.placements = []),
      (s) => (s[0].layout.placements[1].x = 'a'),
      (s) => (s[0].layout.placements[1].pieceId = s[0].layout.placements[0].pieceId),
      (s) => (s[0].layout.cuts[0].within = null),
      (s) => (s[0].layout.orientation = 'x'),
      (s) => (s[0].layout = null),
    ]
    for (const [i, e] of edits.entries()) {
      const r = loadEdited(e)
      expect(r.status, String(i)).toBe('repaired')
      expect(sheetsOf(r), String(i)).toHaveLength(1)
    }
  })

  it('completedAt：全部チェックなら残し（無ければ frozenAt）、そうでなければ消す', () => {
    const missing = loadEdited((s) => {
      delete s[1].completedAt
    })
    expect(missing.status).toBe('repaired')
    expect(sheetsOf(missing)[1].completedAt).toBe(NOW.toISOString())
    const extra = loadEdited((s) => {
      s[0].completedAt = NOW.toISOString()
    })
    expect(extra.status).toBe('repaired')
    expect('completedAt' in sheetsOf(extra)[0]).toBe(false)
  })

  it('材料が削除されていても外さない', () => {
    const r = loadEdited(() => {})
    const raw = JSON.parse(JSON.stringify(ok(removeBoards(frozenJob(), [VENEER_4_ID]))))
    const r2 = loadSaved(stored([raw]), NOW)
    expect(r.status).toBe('ok')
    expect(r2.status).toBe('ok')
    expect(sheetsOf(r2)).toHaveLength(2)
  })
})

describe('コピー・材料の削除', () => {
  it('copyJob は固定した1枚を写さない（以前の完了は写る）', () => {
    const job = frozenJob()
    job.parts = job.parts.map((p) => (p.name === '棚板' ? { ...p, checks: { ...p.checks, cut: true } } : p))
    const c = copyJob(job, [], NOW)
    expect(c.frozenSheets).toEqual([])
    expect(c.parts.find((p) => p.name === '棚板')!.checks.cut).toBe(true)
    expect(job.frozenSheets).toHaveLength(2)
  })

  it('removeBoards は固定した1枚を消さない', () => {
    const job = frozenJob()
    expect(ok(removeBoards(job, [LUMBER_18_ID, VENEER_4_ID])).frozenSheets).toEqual(job.frozenSheets)
  })
})

describe('clearLegacyCut（以前の木取り済みを外す）', () => {
  it('ふつうの部材は checks.cut を false にし、計算に戻る', () => {
    const job = bookshelfJob()
    job.parts = job.parts.map((p) => (p.name === '棚板' ? { ...p, checks: { finished: true, cut: true } } : p))
    expect(pack(job).done.map((d) => d.name)).toEqual(['棚板'])
    const tana = job.parts.find((p) => p.name === '棚板')!
    const j = ok(clearLegacyCut(job, tana.id, LUMBER_18_ID))
    expect(j.parts.find((p) => p.id === tana.id)!.checks).toEqual({ finished: true, cut: false })
    expect(pack(j).done).toEqual([])
    // 材料が未設定の部材（boardId null）でも外せる
    const nb = { ...job, parts: job.parts.map((p) => (p.id === tana.id ? { ...p, boardId: null } : p)) }
    expect(ok(clearLegacyCut(nb, tana.id, null)).parts.find((p) => p.id === tana.id)!.checks.cut).toBe(false)
  })

  it('見本（重ね切りオフ）：棚板の メラミン 1 の完了を外すと packJob に棚板が戻る（ラワン 4 の完了は残る）', () => {
    const on = sampleFromTemplate(defaultTemplate(), NOW)
    const job0 = { ...on, flushes: on.flushes.map(({ stack: _s, ...f }) => f) }
    const mel = job0.boards.find((b) => b.material === 'メラミン' && b.thickness === 1)!.id
    const lau = job0.boards.find((b) => b.material === 'ラワン' && b.thickness === 4)!.id
    const tana = job0.parts.find((p) => p.name === '棚板')!.id
    const job = {
      ...job0,
      parts: job0.parts.map((p) => (p.id === tana ? { ...p, checks: { ...p.checks, cutByBoard: { [mel]: true, [lau]: true } } } : p)),
    }
    const names = (j: Job, b: string) => pack(j).materials.find((m) => m.boardId === b)!.sheets.flatMap((s) => s.placements.map((p) => p.name))
    expect(names(job, mel)).not.toContain('棚板')
    const j = ok(clearLegacyCut(job, tana, mel))
    expect(names(j, mel).filter((n) => n === '棚板')).toHaveLength(8)
    expect(j.parts.find((p) => p.id === tana)!.checks.cutByBoard).toEqual({ [lau]: true })
    expect(pack(j).done).toEqual([{ partId: tana, name: '棚板', quantity: 8, boardId: lau }])
  })

  it('部材が無ければ失敗', () => {
    expect(clearLegacyCut(bookshelfJob(), 'none', null).ok).toBe(false)
  })
})

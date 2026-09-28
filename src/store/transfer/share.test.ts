// S-26：共有のファイル（buildShareFile・shareFileName・importShared。architecture.md 16.4）
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../../engine/dimensions'
import { packJob } from '../../engine/packing'
import type { Job } from '../../engine/types'
import { setPartChecks, setPieceCheck, type OpResult } from '../jobs'
import { sampleFromTemplate } from '../sample'
import { defaultTemplate } from '../template'
import { bigJob } from './fixtures/bigJob'
import { readTransferFile } from './read'
import { buildShareFile, importShared, shareFileName } from './share'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const LATER = new Date('2026-10-01T08:00:00.000Z')
const unwrap = (r: OpResult): Job => {
  if (!r.ok) throw new Error(r.message)
  return r.job
}
const dimsOf = (job: Job) => computeDimensions(job).parts.map((d) => [d.name, d.finished, d.cutSize, d.errors.map((e) => e.kind)])
const packOf = (job: Job) => {
  const r = packJob(job, computeDimensions(job))
  return {
    total: r.totalYieldRate,
    materials: r.materials.map((m) => [m.material, m.thickness, m.stack !== undefined, m.sheetCount, m.yieldRate]),
    unplaced: r.materials.flatMap((m) => m.unplaced.map((u) => u.name)),
    skipped: r.skipped.map((s) => s.name),
  }
}
const idsOf = (job: Job) => [
  job.id,
  ...job.boards.map((b) => b.id),
  ...job.flushes.map((f) => f.id),
  ...job.parts.map((p) => p.id),
  ...job.settings.nige.map((n) => n.id),
]

/** 見本に、切り出しチェック（重ね切りの組の1枚）・完了のチェック・以前の木取り済みを付けたもの */
function usedSample(): Job {
  let job = sampleFromTemplate(defaultTemplate(), NOW)
  const res = packJob(job, computeDimensions(job))
  const st = res.materials.find((m) => m.stack)!
  const t = { kind: 'computed', boardId: st.stack!.boardIds[0], stackWith: st.stack!.boardIds[1], mode: st.mode, layout: st.sheets[0] } as const
  job = unwrap(setPieceCheck(job, t, st.sheets[0].placements[0].pieceId, true, NOW, 'sheet-a'))
  const side = job.parts.find((p) => p.name === '側板')!
  job = unwrap(setPartChecks(job, side.id, { finished: true, cut: true, cutByBoard: { [job.boards[0].id]: true } }))
  job.parts = job.parts.map((p) => (p.name === '背板' ? { ...p, memo: '裏に番号を書く' } : p))
  return job
}

function roundTrip(job: Job, names: string[] = []): Job {
  const r = readTransferFile(buildShareFile(job, NOW))
  if (!r.ok || r.kind !== 'share') throw new Error('読めない')
  return importShared(r.job, names, LATER)
}

describe('buildShareFile', () => {
  it('外側は app・kind: share・version 1・dataVersion 2・exportedAt。空白なしの JSON', () => {
    const text = buildShareFile(sampleFromTemplate(defaultTemplate(), NOW), NOW)
    const data = JSON.parse(text)
    expect([data.app, data.kind, data.version, data.dataVersion, data.exportedAt]).toEqual(['kidori', 'share', 1, 2, NOW.toISOString()])
    expect(text).toBe(JSON.stringify(data))
  })

  it('使っている材料・フラッシュ・逃げ・組の行だけ。固定した1枚・チェック・cutByBoard なし。メモはそのまま。元の仕事は変わらない', () => {
    const src = usedSample()
    const before = JSON.stringify(src)
    const job = JSON.parse(buildShareFile(src, NOW)).job as Job
    expect(JSON.stringify(src)).toBe(before)
    expect(job.boards.map((b) => `${b.material}${b.thickness}`)).toEqual(['メラミン1', 'ラワン4'])
    expect(job.flushes.map((f) => f.name)).toEqual(['フラッシュ25'])
    expect(job.settings.nige.map((n) => n.value)).toEqual([1])
    expect(job.stackSheets).toHaveLength(1)
    expect(job.frozenSheets).toEqual([])
    for (const p of job.parts) expect(p.checks).toEqual({ finished: false, cut: false })
    expect(job.parts.find((p) => p.name === '背板')!.memo).toBe('裏に番号を書く')
    expect([job.settings.kerf, job.settings.trim, job.settings.allowance, job.settings.cutMode]).toEqual([3, 5, 10, 'vertical'])
  })

  it('材料を片方でも外した組の行は入れない。手持ちの行はそのまま', () => {
    const src = sampleFromTemplate(defaultTemplate(), NOW)
    const lauan25 = src.boards.find((b) => b.thickness === 2.5)!
    const lauan4 = src.boards.find((b) => b.thickness === 4)!
    src.stackSheets.push({ boardIds: [lauan25.id, lauan4.id], sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' })
    src.boards = src.boards.map((b) =>
      b.id === lauan4.id ? { ...b, stockOn: true, stock: [{ id: 's1', sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long', count: 3 }] } : b,
    )
    const job = JSON.parse(buildShareFile(src, NOW)).job as Job
    expect(job.stackSheets).toHaveLength(1)
    expect(job.boards.find((b) => b.thickness === 4)!.stock).toHaveLength(1)
  })
})

describe('共有の行って戻る（buildShareFile → readTransferFile → importShared）', () => {
  it('見本：寸法表と木取り（組 5枚 85.2% など）が元と同じ、id は全部新しい。固定した1枚・チェック・cutByBoard は無い', () => {
    const src = usedSample()
    const out = roundTrip(src)
    // 元（チェックを外したもの）と同じ木取り
    const clean = sampleFromTemplate(defaultTemplate(), NOW)
    expect(dimsOf(out)).toEqual(dimsOf(src))
    expect(packOf(out)).toEqual(packOf(clean))
    const stack = packJob(out, computeDimensions(out)).materials.find((m) => m.stack)!
    expect([stack.sheetCount, Math.round(stack.yieldRate * 1000) / 10]).toEqual([5, 85.2])
    const old = new Set(idsOf(src))
    for (const id of idsOf(out)) expect(old.has(id)).toBe(false)
    expect(out.frozenSheets).toEqual([])
    for (const p of out.parts) expect(p.checks).toEqual({ finished: false, cut: false })
    // 初期の ラワン2.5・5.5・逃げ0.5 は入らない
    expect(out.boards.map((b) => b.thickness)).toEqual([1, 4])
    expect(out.settings.nige.map((n) => n.value)).toEqual([1])
    expect(out.name).toBe('本棚 W900')
    expect(out.createdAt).toBe(LATER.toISOString())
    expect(out.updatedAt).toBe(LATER.toISOString())
  })

  it('同じ名前の仕事があると「本棚 W900 のコピー」、さらにあれば「のコピー 2」', () => {
    const src = sampleFromTemplate(defaultTemplate(), NOW)
    expect(roundTrip(src, ['本棚 W900']).name).toBe('本棚 W900 のコピー')
    expect(roundTrip(src, ['本棚 W900', '本棚 W900 のコピー']).name).toBe('本棚 W900 のコピー 2')
    expect(roundTrip(src, ['食器棚']).name).toBe('本棚 W900')
  })

  it('部材 50・150 の仕事でも寸法表・木取りが元と同じ', () => {
    for (const n of [50, 150]) {
      const src = bigJob(n, NOW)
      const t0 = performance.now()
      const out = roundTrip(src)
      expect(performance.now() - t0).toBeLessThan(2000)
      expect(out.parts).toHaveLength(n)
      expect(dimsOf(out)).toEqual(dimsOf(src))
      expect(packOf(out)).toEqual(packOf(src))
    }
  })

  it('ファイルの大きさ（architecture.md 16.4 の目安）：見本 約 2KB、部材 50 約 11KB', () => {
    const size = (job: Job) => new TextEncoder().encode(buildShareFile(job, NOW)).length
    const sample = size(sampleFromTemplate(defaultTemplate(), NOW))
    const fifty = size(bigJob(50, NOW))
    console.log(`共有のファイルの大きさ：見本 ${sample} バイト、部材 50 ${fifty} バイト`)
    expect(sample).toBeLessThan(4 * 1024)
    expect(fifty).toBeLessThan(30 * 1024)
  })
})

describe('shareFileName', () => {
  const name = (n: string) => shareFileName({ name: n })
  it('空白を除いて .kidori.json', () => {
    expect(name('本棚 W900')).toBe('本棚W900.kidori.json')
    expect(name('本棚　W900 ')).toBe('本棚W900.kidori.json')
  })
  it('ファイル名に使えない文字・制御文字を除く', () => {
    expect(name('a/b:c')).toBe('abc.kidori.json')
    expect(name('a\\b*c?d"e<f>g|h\u0001i')).toBe('abcdefghi.kidori.json')
  })
  it('除いて空なら kidori-仕事.kidori.json', () => {
    expect(name('   ')).toBe('kidori-仕事.kidori.json')
    expect(name('')).toBe('kidori-仕事.kidori.json')
    expect(name('/:*')).toBe('kidori-仕事.kidori.json')
  })
  it('名前は 50 文字まで', () => {
    expect(name('あ'.repeat(80))).toBe(`${'あ'.repeat(50)}.kidori.json`)
    expect(name('𠮷'.repeat(60))).toBe(`${'𠮷'.repeat(50)}.kidori.json`)
  })
})

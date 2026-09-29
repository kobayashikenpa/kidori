// 木取りの並べ方を変えたときに、枚数・歩留まりを前と比べるための仕事の一覧（E-68）。
// 見本・重ね切りの見本・フラッシュの机と、家具らしい部材（同じ奥行きの部材が多い）・でたらめな大きさの部材の仕事
import { defaultSettings } from '../defaults'
import type { CutMode, Job, Part, PartGrain } from '../types'
import { bookshelfJob } from './bookshelf'
import { flushJob, sampleGroupJob } from './flush'

/** 決まった順に出るでたらめな数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  }
}

/**
 * 部材の仕事（ラワン18 の 3×6 か 4×8 の1つの材料。部材は厚み D＝18）。
 * furniture：奥行き（W）を 250・300・350・450・580 から選ぶ（家具らしく同じ幅が多い）。そうでなければ 60〜880 のでたらめ
 */
function randomJob(seed: number, furniture: boolean, cutMode: CutMode): Job {
  const r = rng(seed)
  const big = r.int(0, 1) === 1
  const sheet = big
    ? ({ sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long' } as const)
    : ({ sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const)
  const n = r.int(8, 40)
  const parts: Part[] = []
  for (let i = 0; i < n; i++) {
    const w = furniture ? r.pick([250, 300, 350, 450, 580]) : r.int(60, 880)
    const h = r.int(80, 1780)
    parts.push({
      id: `p${i}`,
      name: `部材${i}`,
      boardId: 'b18',
      expr: { W: String(w), H: String(h), D: '18' },
      thicknessAxis: 'D',
      quantity: r.int(1, 4),
      grain: r.pick<PartGrain>(['H', 'W', 'any', 'any']),
      memo: '',
      checks: { finished: false, cut: false },
      allowance: null,
    })
  }
  return {
    id: `job-${seed}`,
    name: `仕事${seed}`,
    settings: { ...defaultSettings(), cutMode },
    boards: [{ id: 'b18', material: 'ラワン', thickness: 18, ...sheet }],
    flushes: [],
    parts,
    frozenSheets: [],
    stackSheets: [],
    stacking: 'off',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** 比べる仕事の一覧（名前と仕事。呼ぶたびに新しいオブジェクト） */
export function yieldCorpus(): { name: string; job: Job }[] {
  const out: { name: string; job: Job }[] = [
    { name: '見本（重ね切りオン）', job: sampleGroupJob(true) },
    { name: '見本（重ね切りオフ）', job: sampleGroupJob(false) },
    { name: '本棚 W900（ランバー）', job: bookshelfJob() },
    { name: 'フラッシュの机', job: flushJob() },
  ]
  const modes: CutMode[] = ['vertical', 'horizontal', 'auto']
  for (let seed = 1; seed <= 60; seed++) {
    const mode = modes[seed % 3]
    out.push({ name: `家具${seed}（${mode}）`, job: randomJob(seed, true, mode) })
    out.push({ name: `でたらめ${seed}（${mode}）`, job: randomJob(1000 + seed, false, mode) })
  }
  return out
}

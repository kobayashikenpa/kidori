// E-68：帯の中は同じ幅の部材を優先する。第2.4版までの並べ方（sameWidthFirst: false）と枚数・歩留まりを比べる
// E-69：初期値（指定なし）は両方を計算して、板が増えないときだけ同じ幅を優先する並べ方を使う
import { describe, expect, it } from 'vitest'
import { computeDimensions } from '../dimensions'
import { yieldCorpus } from '../fixtures/yieldCorpus'
import type { Job, PackingResult } from '../types'
import { packJob } from './index'

const pct = (r: number) => Math.round(r * 1000) / 10
const sheets = (r: PackingResult) => r.materials.reduce((n, m) => n + m.sheetCount, 0)
const pack = (job: Job, sameWidthFirst?: boolean) =>
  packJob(job, computeDimensions(job), undefined, sameWidthFirst === undefined ? {} : { sameWidthFirst })

/** 帯の中に幅の違う片が並ぶ帯の数 */
function mixedStrips(r: PackingResult): number {
  let n = 0
  for (const m of r.materials) {
    for (const s of m.sheets) {
      // 帯は切る順番の strip の切断で分かれる。ここでは片の x（縦切り）／y（横切り）と幅で同じ帯を見分ける
      const key = (p: (typeof s.placements)[number]) => (s.orientation === 'portrait' ? `${p.x + p.w}` : `${p.y + p.h}`)
      const byStrip = new Map<string, Set<number>>()
      for (const p of s.placements) {
        const k = key(p)
        const w = s.orientation === 'portrait' ? p.w : p.h
        byStrip.set(k, (byStrip.get(k) ?? new Set()).add(w))
      }
      for (const ws of byStrip.values()) if (ws.size > 1) n++
    }
  }
  return n
}

describe('帯の中は同じ幅を優先（E-68）：前の並べ方との比べ', () => {
  const corpus = yieldCorpus()
  const rows = corpus.map(({ name, job }) => {
    const before = pack(job, false)
    const after = pack(job, true)
    const chosen = pack(job)
    return { name, before, after, chosen }
  })

  it('見本・重ね切りの見本・本棚・フラッシュの机は枚数も歩留まりも同じ（組 5枚 85.2%・ラワン4 97.8%・全体 86.4%）', () => {
    for (const r of rows.slice(0, 4)) {
      expect([r.name, sheets(r.after), pct(r.after.totalYieldRate)]).toEqual([r.name, sheets(r.before), pct(r.before.totalYieldRate)])
    }
    const s = rows[0].after
    expect(s.materials.map((m) => [m.sheetCount, pct(m.yieldRate)])).toEqual([
      [5, 85.2],
      [1, 97.8],
    ])
    expect(pct(s.totalYieldRate)).toBe(86.4)
  })

  it('家具らしい仕事・でたらめな仕事（各60件）：枚数の合計と、増えた・減った件数（報告用に値を固定）', () => {
    const sum = (prefix: string) => {
      const xs = rows.filter((r) => r.name.startsWith(prefix))
      return {
        before: xs.reduce((n, r) => n + sheets(r.before), 0),
        after: xs.reduce((n, r) => n + sheets(r.after), 0),
        more: xs.filter((r) => sheets(r.after) > sheets(r.before)).length,
        fewer: xs.filter((r) => sheets(r.after) < sheets(r.before)).length,
        mixedBefore: xs.reduce((n, r) => n + mixedStrips(r.before), 0),
        mixedAfter: xs.reduce((n, r) => n + mixedStrips(r.after), 0),
      }
    }
    // 同じ幅を優先すると、幅の違う片が混ざる帯は減るが、板の幅を早く使い切るぶん 1枚増える仕事がある
    expect(sum('家具')).toEqual({ before: 634, after: 642, more: 8, fewer: 0, mixedBefore: 621, mixedAfter: 450 })
    expect(sum('でたらめ')).toEqual({ before: 895, after: 914, more: 17, fewer: 0, mixedBefore: 852, mixedAfter: 706 })
  })

  it('初期値（E-69）：第2.4版までより板が増える仕事は無く、増えない仕事は同じ幅を優先する並べ方で帯が混ざりにくい', () => {
    for (const r of rows) {
      // 材料ごとに、入らない片・板の枚数とも第2.4版まで以下
      r.chosen.materials.forEach((m, i) => {
        const b = r.before.materials[i]
        expect([r.name, m.unplaced.length <= b.unplaced.length, m.sheetCount <= b.sheetCount]).toEqual([r.name, true, true])
      })
    }
    const sum = (prefix: string) => {
      const xs = rows.filter((r) => r.name.startsWith(prefix))
      return {
        before: xs.reduce((n, r) => n + sheets(r.before), 0),
        chosen: xs.reduce((n, r) => n + sheets(r.chosen), 0),
        more: xs.filter((r) => sheets(r.chosen) > sheets(r.before)).length,
        fewer: xs.filter((r) => sheets(r.chosen) < sheets(r.before)).length,
        mixedBefore: xs.reduce((n, r) => n + mixedStrips(r.before), 0),
        mixedChosen: xs.reduce((n, r) => n + mixedStrips(r.chosen), 0),
        // 同じ幅を優先する並べ方を使った件数（配置が同じ幅を優先したときと同じ）
        sameWay: xs.filter((r) => JSON.stringify(r.chosen.materials) === JSON.stringify(r.after.materials)).length,
      }
    }
    // 同じ幅を優先すると板が増えた仕事（家具 8件・でたらめ 17件）だけ今までの並べ方に戻り、ほかは同じ幅を優先する並べ方のまま
    expect(sum('家具')).toEqual({ before: 634, chosen: 634, more: 0, fewer: 0, mixedBefore: 621, mixedChosen: 482, sameWay: 52 })
    expect(sum('でたらめ')).toEqual({ before: 895, chosen: 895, more: 0, fewer: 0, mixedBefore: 852, mixedChosen: 787, sameWay: 43 })
    const s = rows[0].chosen
    expect(s.materials.map((m) => [m.sheetCount, pct(m.yieldRate)])).toEqual([
      [5, 85.2],
      [1, 97.8],
    ])
    expect(pct(s.totalYieldRate)).toBe(86.4)
  })

  it('部材 100 枚超でも前と同じくすぐ終わる', () => {
    const big = corpus.map((c) => c.job).filter((j) => j.parts.reduce((n, p) => n + p.quantity, 0) > 100)
    expect(big.length).toBeGreaterThan(0)
    const t = performance.now()
    // 初期値は2つの並べ方の両方を計算する
    for (const j of big) pack(j)
    expect(performance.now() - t).toBeLessThan(2000)
  })
})

// 端材の行のまとめ（第2.9版。仕様書 9.4「端材の表示」）：stockUsage の端材の行（1枚ずつ）を、
// 同じ大きさ・同じ重ねた板ごとに1行にまとめ、1枚でも使う行（used）と使わない行（unused）に分ける
import type { OffcutUsage } from './frozen'

/** まとめた端材の1行 */
export interface OffcutGroup {
  /** まとめた端材の行の id（元の並び） */
  stockIds: string[]
  /** 「端材 96×390 ×2枚（重ねた板4から）」（1枚なら「×1枚」は付けない） */
  label: string
  /** 重ねた板の番号 */
  source: number
  /** まとめた枚数 */
  count: number
  /** 使った枚数（stockRowStatus に渡して 採用／◯枚採用／不採用） */
  used: number
}

export interface OffcutGroups {
  /** 1枚でも使う行（元の並び） */
  used: OffcutGroup[]
  /** 1枚も使わない行（元の並び） */
  unused: OffcutGroup[]
  /** 使った端材の枚数 */
  usedCount: number
  /** 使わない行の端材の枚数（「使わない端材 ◯枚」） */
  unusedCount: number
}

/** 端材の行をまとめる。同じ行とみなすのは 短辺・長辺（小数第1位まで。stockUsage の値のまま）・重ねた板 が同じもの */
export function groupOffcuts(offcuts: readonly OffcutUsage[]): OffcutGroups {
  const groups: (OffcutGroup & { width: number; length: number })[] = []
  for (const o of offcuts) {
    const g = groups.find((x) => x.source === o.source && x.width === o.width && x.length === o.length)
    if (g) {
      g.stockIds.push(o.stockId)
      g.count += o.count
      g.used += o.used
    } else {
      groups.push({ stockIds: [o.stockId], label: '', source: o.source, count: o.count, used: o.used, width: o.width, length: o.length })
    }
  }
  const out: OffcutGroup[] = groups.map(({ width, length, ...g }) => ({
    ...g,
    label: `端材 ${width}×${length}${g.count > 1 ? ` ×${g.count}枚` : ''}（重ねた板${g.source}から）`,
  }))
  const used = out.filter((g) => g.used > 0)
  const unused = out.filter((g) => g.used <= 0)
  return {
    used,
    unused,
    usedCount: used.reduce((n, g) => n + g.used, 0),
    unusedCount: unused.reduce((n, g) => n + g.count, 0),
  }
}

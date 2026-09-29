// 手持ちの行の表示（第2.5版。仕様書 9「手持ちの行の表示」）。枚数は engine の stockUsage、入らない部材の有無は stockShortage の結果を使う
export type StockRowKind = 'noFit' | 'unused' | 'part' | 'all'

/**
 * 手持ちの行の表示：
 * - 1枚も使っていない行で、その材料に入らない部材がある（残っている部材がこの行の大きさに入らない）→「部材が収まりません」
 * - 1枚も使っていない →「不採用」、一部を使う →「◯枚採用（残り ◯枚）」、全部使う →「採用」
 * 画面（StockEditor）はこの text をそのまま出す（文言はここだけで決める）
 */
export function stockRowStatus(used: number, count: number, short: boolean): { kind: StockRowKind; text: string } {
  if (used <= 0) return short ? { kind: 'noFit', text: '部材が収まりません' } : { kind: 'unused', text: '不採用' }
  if (used >= count) return { kind: 'all', text: '採用' }
  return { kind: 'part', text: `${used}枚採用（残り ${count - used}枚）` }
}

// 手持ちの行の表示（第2.5版。仕様書 9「手持ちの行の表示」）。枚数は engine の stockUsage、入らない部材はサイズのボタンの「部材が収まりません」で示す
export type StockRowKind = 'unused' | 'part' | 'all'

/**
 * 手持ちの行の表示：
 * - 1枚も使っていない →「不採用」、一部を使う →「◯枚採用」、全部使う →「採用」
 * 画面（StockEditor）はこの text をそのまま出す（文言はここだけで決める）
 */
export function stockRowStatus(used: number, count: number): { kind: StockRowKind; text: string } {
  if (used <= 0) return { kind: 'unused', text: '不採用' }
  if (used >= count) return { kind: 'all', text: '採用' }
  return { kind: 'part', text: `${used}枚採用` }
}

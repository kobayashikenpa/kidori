// 手持ちの材料（第2.2版）のテスト用の手助け
import { BOARD_SIZES, type Job, type StockSheet } from '../types'

export type StockRowDraft = ['3×6' | '4×8', number] | { width: number; length: number; grain: 'long' | 'short'; count: number }

/** 手持ちの行（id は s1, s2, … の登録順） */
export function stockRows(rows: readonly StockRowDraft[]): StockSheet[] {
  return rows.map((r, i): StockSheet => {
    const id = `s${i + 1}`
    if (Array.isArray(r)) {
      const kind = r[0] === '3×6' ? 'saburoku' : 'shihachi'
      const [width, length] = BOARD_SIZES[kind]
      return { id, sizeKind: kind, width, length, grain: 'long', count: r[1] }
    }
    return { id, sizeKind: 'custom', ...r }
  })
}

/** 材料 boardId を手持ちで木取りする（仕事を書き換えて返す） */
export function withStock(job: Job, boardId: string, rows: readonly StockRowDraft[]): Job {
  const b = job.boards.find((x) => x.id === boardId)
  if (!b) throw new Error(`材料が見つかりません: ${boardId}`)
  b.stockOn = true
  b.stock = stockRows(rows)
  return job
}

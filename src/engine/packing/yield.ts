// 歩留まり：部材（木取り寸法）の面積の合計 ÷ 板全体の面積（耳落とし前の 短辺×長辺）
import type { Rect } from '../types'

export interface YieldPart {
  /** 部材（木取り寸法）の面積の合計 */
  usedArea: number
  /** 板全体の面積の合計 */
  boardArea: number
  /** 歩留まり 0〜1 */
  yieldRate: number
}

function rate(used: number, board: number): number {
  return board > 0 ? used / board : 0
}

/** 板1枚の歩留まり */
export function sheetYield(placements: readonly Rect[], board: { width: number; length: number }): YieldPart {
  let usedArea = 0
  for (const p of placements) usedArea += p.w * p.h
  const boardArea = board.width * board.length
  return { usedArea, boardArea, yieldRate: rate(usedArea, boardArea) }
}

/** 何枚かの板をまとめた歩留まり（材料ごと・全体）：面積の合計 ÷ 板の面積の合計 */
export function combineYield(items: readonly Pick<YieldPart, 'usedArea' | 'boardArea'>[]): YieldPart {
  let usedArea = 0
  let boardArea = 0
  for (const y of items) {
    usedArea += y.usedArea
    boardArea += y.boardArea
  }
  return { usedArea, boardArea, yieldRate: rate(usedArea, boardArea) }
}

// 材料の表示（第2.5版）：材料名ごとの見出しでまとめる・木取りしない材料の名前
// 並びは変えない（あとから足した材料 → 最初から入っている材料。仕様書 5.1）。隣り合う同じ材料名をまとめるだけ
import type { Board } from '../engine/types'
import { boardLabel } from '../store/jobs'

/** 見出しに使う材料名（前後の空白・全角半角をそろえる） */
export function materialName(b: Pick<Board, 'material'>): string {
  return b.material.trim().normalize('NFKC')
}

/** 選ぶ欄の材料の名前（例：ラワン 18mm、芯材 15mm（木取りしない）） */
export function materialLabel(b: Pick<Board, 'material' | 'thickness' | 'noCut'>): string {
  return b.noCut === true ? `${boardLabel(b)}（木取りしない）` : boardLabel(b)
}

/** 隣り合う同じ材料名の材料を1つにまとめる（並び順はそのまま） */
export function materialRuns<T extends Pick<Board, 'material'>>(boards: readonly T[]): { name: string; boards: T[] }[] {
  const out: { name: string; boards: T[] }[] = []
  for (const b of boards) {
    const name = materialName(b)
    const last = out[out.length - 1]
    if (last && last.name === name) last.boards.push(b)
    else out.push({ name, boards: [b] })
  }
  return out
}

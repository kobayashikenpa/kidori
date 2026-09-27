// 木取りの画面：手持ちが足りないときの知らせと解決策（第2.2版。仕様書 9「手持ちの材料」・architecture.md 14.11）。
// 解決策は engine の stockShortage の結果をそのまま出す。設定・手持ちは自動では変えず、
// 「足す」ボタンを押したときだけ手持ちに足す（同じサイズの行があればその枚数を増やす）
import type { AddKind, StockShortage } from '../../engine/hints/shortage'
import { BOARD_SIZES } from '../../engine/types'
import { addStockSheet, updateStockSheet } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { fmt } from '../format'

const ADD_NAME: Record<AddKind, string> = { saburoku: '3×6', shihachi: '4×8' }
const CHANGE_NAME = { allowance: '切り代', trim: '端切り' } as const

export function StockShortageNotice({ shortages }: { shortages: StockShortage[] }) {
  const { run } = useCurrentJob()
  if (shortages.length === 0) return null

  const add = (boardId: string, kind: AddKind, count: number) =>
    run((j) => {
      const board = j.boards.find((b) => b.id === boardId)
      const same = board?.stock?.find((s) => s.sizeKind === kind)
      if (same) return updateStockSheet(j, boardId, same.id, { count: same.count + count })
      const [width, length] = BOARD_SIZES[kind]
      return addStockSheet(j, boardId, { sizeKind: kind, width, length, grain: 'long', count })
    })

  return (
    <div className="stack" style={{ marginTop: 14 }}>
      {shortages.map((sh) => (
        <aside key={sh.boardId} className="card kd-issues err kd-short" role="alert" aria-label={sh.message}>
          <h4>{sh.message}</h4>
          <ul className="kd-short-list">
            {sh.add.map(
              (a) =>
                a.count !== null && (
                  <li key={a.kind} className="kd-short-row">
                    <span className="num">
                      {ADD_NAME[a.kind]} を {a.count}枚 足すと入ります
                    </span>
                    <button
                      type="button"
                      className="btn kd-short-btn"
                      aria-label={`${sh.label} の手持ちに ${ADD_NAME[a.kind]} を ${a.count}枚 足す`}
                      onClick={() => add(sh.boardId, a.kind, a.count!)}
                    >
                      足す
                    </button>
                  </li>
                ),
            )}
            {sh.change && (
              <li className="kd-short-row">
                <span className="num">
                  {CHANGE_NAME[sh.change.kind]}を {fmt(sh.change.value)}mm にすると手持ちで入ります
                </span>
              </li>
            )}
            {sh.add.every((a) => a.count === null) && !sh.change && (
              <li className="kd-short-row">寸法か手持ちの材料を見直してください</li>
            )}
          </ul>
          <p className="band-note">
            手持ち・設定は変えていません。「足す」を押すと手持ちに足します。{sh.change ? '切り代・端切りは設定の画面で変えてください。' : ''}
          </p>
        </aside>
      ))}
    </div>
  )
}

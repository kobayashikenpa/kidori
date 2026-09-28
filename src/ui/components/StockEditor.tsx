// 木取りの画面の「手持ちの材料」の段（第2.2版。仕様書 9「手持ちの材料」・architecture.md 14.11）。
// 材料ごとに「サイズを選ぶ／手持ちで木取り」を切り替え、手持ちの行（サイズ・枚数）を足す・変える・消す。
// 使う・残りの枚数は engine の stockUsage の結果をそのまま出す。保存は store の操作（setRowStockMode など）
import { useState } from 'react'
import type { StockUsage } from '../../engine/progress/frozen'
import type { Board, BoardGrain, BoardSizeKind, StockSheet } from '../../engine/types'
import { addRowStock, boardLabel, removeRowStock, setRowStockMode, updateRowStock } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { exactText } from '../../engine/round'
import { fmt, parseNum } from '../format'
import { KeypadField } from './KeypadField'
import { Segmented } from './Segmented'

const SIZE_OPTIONS: { value: BoardSizeKind; label: string }[] = [
  { value: 'saburoku', label: '3×6' },
  { value: 'shihachi', label: '4×8' },
  { value: 'custom', label: '自由入力' },
]

const GRAIN_OPTIONS: { value: BoardGrain; label: string }[] = [
  { value: 'long', label: '木目 長手方向' },
  { value: 'short', label: '木目 妻手方向' },
]

interface Props {
  /** 手持ちの段に出す材料（木取りする片のある材料。組だけで使う材料を含む） */
  boards: Board[]
  usage: StockUsage[]
}

export function StockEditor({ boards, usage }: Props) {
  if (boards.length === 0) return null
  return (
    <div className="stk-list">
      {boards.map((b) => (
        <StockMaterial key={b.id} board={b} usage={usage.find((u) => u.boardId === b.id) ?? null} />
      ))}
    </div>
  )
}

function StockMaterial({ board, usage }: { board: Board; usage: StockUsage | null }) {
  const { run } = useCurrentJob()
  const [error, setError] = useState<string | null>(null)
  const on = board.stockOn === true
  const label = boardLabel(board)
  const report = (r: { ok: boolean; message?: string }) => setError(r.ok ? null : (r.message ?? '変えられませんでした'))
  return (
    <div className="stk-mat" aria-label={`${label} の手持ち`} role="group">
      <div className="stk-name">{label}</div>
      <Segmented
        ariaLabel={`${label} の木取りのしかた`}
        value={on ? 'stock' : 'size'}
        options={[
          { value: 'size', label: 'サイズを選ぶ' },
          { value: 'stock', label: '手持ちで木取り' },
        ]}
        onChange={(v) => report(run((j) => setRowStockMode(j, board.id, v === 'stock')))}
      />
      {on && (
        <>
          <ul className="stk-rows">
            {(board.stock ?? []).map((s) => (
              <StockRow
                key={s.id}
                board={board}
                sheet={s}
                use={usage?.rows.find((r) => r.stockId === s.id) ?? null}
                onResult={report}
              />
            ))}
          </ul>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              report(
                run((j) =>
                  addRowStock(j, board.id, {
                    sizeKind: board.sizeKind,
                    width: board.width,
                    length: board.length,
                    grain: board.grain,
                    count: 1,
                  }),
                ),
              )
            }
          >
            ＋ 手持ちを足す
          </button>
        </>
      )}
      {error && <p className="msg err">{error}</p>}
    </div>
  )
}

interface RowProps {
  board: Board
  sheet: StockSheet
  use: StockUsage['rows'][number] | null
  onResult: (r: { ok: boolean; message?: string }) => void
}

function StockRow({ board, sheet, use, onResult }: RowProps) {
  const { run } = useCurrentJob()
  const update = (patch: Partial<Omit<StockSheet, 'id'>>) => onResult(run((j) => updateRowStock(j, board.id, sheet.id, patch)))
  const name = `${boardLabel(board)} の手持ち`
  return (
    <li className="stk-row">
      <Segmented ariaLabel={`${name}のサイズ`} value={sheet.sizeKind} options={SIZE_OPTIONS} onChange={(v) => update({ sizeKind: v })} />
      {sheet.sizeKind === 'custom' && (
        <>
          <div className="stk-dims">
            <label className="stk-field">
              <span className="kd-k">短辺（妻手）</span>
              <CommitField ariaLabel="短辺（妻手）" value={sheet.width} unit="mm" onCommit={(v) => update({ width: v })} />
            </label>
            <label className="stk-field">
              <span className="kd-k">長辺（長手）</span>
              <CommitField ariaLabel="長辺（長手）" value={sheet.length} unit="mm" onCommit={(v) => update({ length: v })} />
            </label>
          </div>
          <Segmented ariaLabel={`${name}の木目`} value={sheet.grain} options={GRAIN_OPTIONS} onChange={(v) => update({ grain: v })} />
        </>
      )}
      <div className="stk-foot">
        <label className="stk-field stk-count">
          <span className="kd-k">枚数</span>
          <CommitField ariaLabel="手持ちの枚数" value={sheet.count} unit="枚" integer onCommit={(v) => update({ count: v })} />
        </label>
        <span className="stk-use num" aria-label="使う枚数と残り">
          使う <b>{use?.used ?? 0}</b>／残り <b>{use?.left ?? sheet.count}</b>
        </span>
        <button
          type="button"
          className="btn danger stk-del"
          aria-label={`${sheet.sizeKind === 'custom' ? `${fmt(sheet.width)}×${fmt(sheet.length)}` : SIZE_OPTIONS.find((o) => o.value === sheet.sizeKind)?.label} の手持ちを消す`}
          onClick={() => onResult(run((j) => removeRowStock(j, board.id, sheet.id)))}
        >
          削除
        </button>
      </div>
    </li>
  )
}

interface FieldProps {
  value: number
  unit: string
  integer?: boolean
  ariaLabel: string
  onCommit: (v: number) => void
}

/** 数字キーで入れ、閉じたときに決める欄（打っている途中の数で保存しないように） */
function CommitField({ value, unit, integer, ariaLabel, onCommit }: FieldProps) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? fmt(value)
  const v = parseNum(shown)
  const bad = v === null || Number.isNaN(v) || v <= 0 || (integer === true && !Number.isInteger(v))
  return (
    <KeypadField
      ariaLabel={ariaLabel}
      text={shown}
      integer={integer}
      bad={bad}
      unit={unit}
      onOpen={() => setText(exactText(value))}
      onText={setText}
      onClose={() => {
        setText(null)
        if (v !== null && v !== value) onCommit(v)
      }}
    />
  )
}

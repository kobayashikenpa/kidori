// 木取りの画面：材料の行で「自由入力」を選んだときの、その行の手持ちの編集（重ね切りの組の行は手持ちを使わない。architecture.md 15.9）
// （第2.3版。仕様書 9「手持ちの材料」・architecture.md 15.8）。手持ちの行（サイズ・枚数）を足す・変える・消す。
// 使う・残りの枚数は engine の stockUsage の結果をそのまま出す。保存は store の操作（addRowStock など。SizeTarget で行を指す）
import { useState } from 'react'
import type { StockUsage } from '../../engine/progress/frozen'
import type { BoardGrain, BoardSizeKind, SheetChoice, StockSheet } from '../../engine/types'
import { addRowStock, removeRowStock, setRowStockMode, updateRowStock, type SizeTarget } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { exactText } from '../../engine/round'
import { fmt, parseNum } from '../format'
import { stockRowStatus } from '../stockStatus'
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
  /** 操作する行（材料の id、組なら2つの材料の id） */
  target: SizeTarget
  /** その行の今の設定（材料の行は Board、組の行は stackChoice） */
  choice: SheetChoice
  /** 行の表示名（読み上げ用） */
  label: string
  /** その行の stockUsage（手持ちで木取りしていなければ null） */
  usage: StockUsage | null
  /** 手持ちに入らない部材がある材料か（engine の stockShortage に出ている） */
  short: boolean
}

export function StockEditor({ target, choice, label, usage, short }: Props) {
  const { run } = useCurrentJob()
  const [error, setError] = useState<string | null>(null)
  const on = choice.stockOn === true
  const report = (r: { ok: boolean; message?: string }) => setError(r.ok ? null : (r.message ?? '変えられませんでした'))
  return (
    <div className="stk-mat" aria-label={`${label} の手持ち`} role="group">
      <div className="kd-k">手持ちの材料（この行の分）</div>
      {on ? (
        <ul className="stk-rows">
          {(choice.stock ?? []).map((s) => (
            <StockRow
              key={s.id}
              target={target}
              label={label}
              sheet={s}
              use={usage?.rows.find((r) => r.stockId === s.id) ?? null}
              short={short}
              onResult={report}
            />
          ))}
        </ul>
      ) : (
        // 以前の版の「自由入力」（大きさだけで枚数の指定なし）
        <p className="band-note num" style={{ margin: 0 }}>
          {fmt(choice.width)}×{fmt(choice.length)}（枚数の指定なし）
        </p>
      )}
      <button
        type="button"
        className="btn ghost"
        onClick={() =>
          report(
            run((j) =>
              on
                ? addRowStock(j, target, {
                    sizeKind: choice.sizeKind,
                    width: choice.width,
                    length: choice.length,
                    grain: choice.grain,
                    count: 1,
                  })
                : setRowStockMode(j, target, true),
            ),
          )
        }
      >
        ＋ 手持ちを足す
      </button>
      {error && <p className="msg err">{error}</p>}
    </div>
  )
}

interface RowProps {
  target: SizeTarget
  label: string
  sheet: StockSheet
  use: StockUsage['rows'][number] | null
  short: boolean
  onResult: (r: { ok: boolean; message?: string }) => void
}

function StockRow({ target, label, sheet, use, short, onResult }: RowProps) {
  const { run } = useCurrentJob()
  const update = (patch: Partial<Omit<StockSheet, 'id'>>) => onResult(run((j) => updateRowStock(j, target, sheet.id, patch)))
  const name = `${label} の手持ち`
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
        <StockRowStatus used={use?.used ?? 0} count={sheet.count} short={short} />
        <button
          type="button"
          className="btn danger stk-del"
          aria-label={`${sheet.sizeKind === 'custom' ? `${fmt(sheet.width)}×${fmt(sheet.length)}` : SIZE_OPTIONS.find((o) => o.value === sheet.sizeKind)?.label} の手持ちを消す`}
          onClick={() => onResult(run((j) => removeRowStock(j, target, sheet.id)))}
        >
          削除
        </button>
      </div>
    </li>
  )
}

/** 手持ちの行の表示（仕様書 9「手持ちの行の表示」）：部材が収まりません／不採用／◯枚採用／採用 */
function StockRowStatus({ used, count, short }: { used: number; count: number; short: boolean }) {
  const st = stockRowStatus(used, count, short)
  return (
    <span className={`stk-use num stk-${st.kind}`} role="status">
      {st.kind === 'part' ? (
        <>
          <b>{used}</b>枚採用（残り {count - used}枚）
        </>
      ) : (
        st.text
      )}
    </span>
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

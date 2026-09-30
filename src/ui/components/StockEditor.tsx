// 木取りの画面：材料の行で「自由入力」を選んだときの、その行の手持ちの編集（重ね切りの組の行は手持ちを使わない。architecture.md 15.9）
// （第2.3版。仕様書 9「手持ちの材料」・architecture.md 15.8）。手持ちの行（サイズ・枚数）を足す・変える・消す。
// 使う・残りの枚数は engine の stockUsage の結果をそのまま出す。保存は store の操作（addRowStock など。SizeTarget で行を指す）
import { useState } from 'react'
import type { StockUsage } from '../../engine/progress/frozen'
import { groupOffcuts, type OffcutGroup } from '../../engine/progress/offcutGroups'
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
}

export function StockEditor({ target, choice, label, usage }: Props) {
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
      <OffcutRows usage={usage} />
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
  onResult: (r: { ok: boolean; message?: string }) => void
}

function StockRow({ target, label, sheet, use, onResult }: RowProps) {
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
        <StockRowStatus used={use?.used ?? 0} count={sheet.count} />
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

/**
 * 重ねた板の端材の行（第2.6版。仕様書 10.9・architecture.md 18.9）。読むだけ（消す・枚数を変えるはできない）。
 * 第2.9版（仕様書 9.4）：同じ大きさ・同じ重ねた板の端材は1行（「端材 96×390 ×2枚（重ねた板4から）」。まとめは engine の groupOffcuts）。
 * 使う端材だけを並べ、使わない端材は「使わない端材 ◯枚」の1行にたたむ（押すと開く）。端材の行が無ければ何も出さない
 */
export function OffcutRows({ usage }: { usage: StockUsage | null }) {
  const [open, setOpen] = useState(false)
  const list = usage?.offcuts ?? []
  if (list.length === 0) return null
  const g = groupOffcuts(list)
  const rows = (items: OffcutGroup[], label: string) => (
    <ul className="stk-rows" aria-label={label}>
      {items.map((o) => (
        <li key={o.stockIds[0]} className="stk-row stk-offcut">
          <div className="stk-foot">
            <span className="stk-name num stk-offcut-name">{o.label}</span>
            <StockRowStatus used={o.used} count={o.count} />
          </div>
        </li>
      ))}
    </ul>
  )
  return (
    <>
      {g.used.length > 0 && (
        <>
          <div className="kd-k">使う端材（重ねた板から・自動）</div>
          {rows(g.used, '使う端材')}
        </>
      )}
      {g.unused.length > 0 && (
        <>
          <button type="button" className="stk-off-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="num">使わない端材 {g.unusedCount}枚</span>
            <span className="stk-off-hint">{open ? '閉じる' : '開いて見る'}</span>
          </button>
          {open && rows(g.unused, '使わない端材')}
        </>
      )}
    </>
  )
}

/** 手持ちの行の表示（仕様書 9「手持ちの行の表示」）：不採用／◯枚採用／採用 */
function StockRowStatus({ used, count }: { used: number; count: number }) {
  const st = stockRowStatus(used, count)
  return (
    <span className={`stk-use num stk-${st.kind}`} role="status">
      {st.text}
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

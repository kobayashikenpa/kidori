// 木取りの画面の材料のサイズの選択（仕様書 9「材料のサイズの選択」・architecture.md 8.6・8.7）。
// 3×6・4×8 の必要な枚数・歩留まり（engine の compareStandardSizes の結果）を並べ、押して選ぶ。
// 自由入力は短辺・長辺・木目の方向を入れて「このサイズにする」で決める。選ぶと setBoardSize で仕事に保存する
import { useState } from 'react'
import type { MaterialSizeComparison, SizeSummary, StandardSize } from '../../engine/packing/sizes'
import type { Board, BoardGrain, MaterialResult } from '../../engine/types'
import { setBoardSize } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { closeKeyboard } from '../keyboard'
import { fmt, pct } from '../format'
import { NumberField } from './NumberField'
import { Segmented } from './Segmented'

const SIZE_NAME: Record<StandardSize, string> = { saburoku: '3×6', shihachi: '4×8' }

interface Props {
  board: Board
  /** compareStandardSizes の結果（3×6、4×8 の順の options と、枚数が少ない方・歩留まりが高い方） */
  compare: MaterialSizeComparison | null
  /** 今選んでいるサイズでの結果（自由入力の枚数・歩留まりに使う） */
  current: MaterialResult
}

export function SheetSizePicker({ board, compare, current }: Props) {
  const { run } = useCurrentJob()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isCustom = board.sizeKind === 'custom'
  const options = compare?.options ?? null
  const fewer = compare?.fewer ?? null
  const higher = compare?.higher ?? null

  const choose = (o: SizeSummary) => {
    setEditing(false)
    setError(null)
    if (board.sizeKind === o.kind) return
    run((j) => setBoardSize(j, board.id, { sizeKind: o.kind, width: o.width, length: o.length, grain: 'long' }))
  }

  return (
    <div className="sz">
      <div className="sz-head">
        <span className="kd-k">材料のサイズ（押して選ぶ）</span>
        <span className="kd-k num">
          今：{board.sizeKind === 'custom' ? '自由入力' : SIZE_NAME[board.sizeKind]} {fmt(board.width)}×{fmt(board.length)}
        </span>
      </div>
      <div className="sz-opts" role="group" aria-label={`材料のサイズ：${board.material}`}>
        {options?.map((o) => (
          <button
            key={o.kind}
            type="button"
            className="sz-opt"
            aria-pressed={board.sizeKind === o.kind}
            onClick={() => choose(o)}
          >
            <span className="sz-name">{SIZE_NAME[o.kind]}</span>
            <span className="sz-n num">{o.sheetCount}枚</span>
            <span className="sz-y num">{o.sheetCount > 0 ? pct(o.yieldRate) : '―'}</span>
            <span className="sz-tags">
              {o.unplacedCount > 0 && <span className="sz-tag err">入らない {o.unplacedCount}</span>}
              {fewer === o.kind && <span className="sz-tag ok">枚数が少ない</span>}
              {higher === o.kind && <span className="sz-tag ok">歩留まりが高い</span>}
            </span>
          </button>
        ))}
        <button
          type="button"
          className="sz-opt"
          aria-pressed={isCustom}
          aria-expanded={editing}
          onClick={() => {
            setError(null)
            setEditing((v) => !v)
          }}
        >
          <span className="sz-name">自由入力</span>
          {isCustom ? (
            <>
              <span className="sz-n num">{current.sheetCount}枚</span>
              <span className="sz-y num">{current.sheetCount > 0 ? pct(current.yieldRate) : '―'}</span>
              <span className="sz-tags">
                {current.unplaced.length > 0 && <span className="sz-tag err">入らない {current.unplaced.length}</span>}
              </span>
            </>
          ) : (
            <span className="sz-y sz-muted">寸法を入れる</span>
          )}
        </button>
      </div>
      {editing && (
        <CustomForm
          board={board}
          onDone={(size) => {
            const r = run((j) => setBoardSize(j, board.id, { sizeKind: 'custom', ...size }))
            if (!r.ok) return setError(r.message)
            closeKeyboard()
            setError(null)
            setEditing(false)
          }}
          onCancel={() => {
            setError(null)
            setEditing(false)
          }}
          error={error}
          setError={setError}
        />
      )}
    </div>
  )
}

interface FormProps {
  board: Board
  onDone: (size: { width: number; length: number; grain: BoardGrain }) => void
  onCancel: () => void
  error: string | null
  setError: (e: string | null) => void
}

/** 自由入力の欄。初めは今の材料のサイズ・木目を入れておく */
function CustomForm({ board, onDone, onCancel, error, setError }: FormProps) {
  const [width, setWidth] = useState<number | null>(board.width)
  const [length, setLength] = useState<number | null>(board.length)
  const [grain, setGrain] = useState<BoardGrain>(board.sizeKind === 'custom' ? board.grain : 'long')
  const pre = `sz-${board.id}`

  const apply = () => {
    if (width === null || length === null) return setError('短辺と長辺を入れてください')
    if (!(width > 0 && length > 0)) return setError('短辺と長辺は 0 より大きい数を入れてください')
    onDone({ width, length, grain })
  }

  return (
    <div className="sz-form">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-w`}>
            短辺（妻手）
          </label>
          <NumberField id={`${pre}-w`} allowEmpty value={width} onChange={(v) => (setWidth(v), setError(null))} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 0 }}>
          <label className="label" htmlFor={`${pre}-l`}>
            長辺（長手）
          </label>
          <NumberField id={`${pre}-l`} allowEmpty value={length} onChange={(v) => (setLength(v), setError(null))} />
        </div>
      </div>
      <div className="field">
        <span className="label">木目の方向</span>
        <Segmented<BoardGrain>
          ariaLabel="木目の方向"
          value={grain}
          options={[
            { value: 'long', label: '長手方向' },
            { value: 'short', label: '妻手方向' },
          ]}
          onChange={setGrain}
        />
      </div>
      {error && <p className="msg err">{error}</p>}
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={onCancel}>
          やめる
        </button>
        <button type="button" className="btn primary" onClick={apply}>
          このサイズにする
        </button>
      </div>
    </div>
  )
}

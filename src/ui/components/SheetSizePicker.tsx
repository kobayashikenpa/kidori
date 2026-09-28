// 木取りの画面のまとめの行（材料の行・重ね切りの組の行）のサイズの選択（仕様書 9「材料のサイズの選択」・architecture.md 15.8）。
// 3×6・4×8 の必要な枚数・歩留まり（engine の compareStandardSizes の結果）と 自由入力 を並べ、押して選ぶ。
// 3×6・4×8 は setRowSize、自由入力は setRowStockMode（＝その行の手持ちで木取り）。自由入力を選んでいる行の下に、その行の手持ちの編集
import { useState } from 'react'
import type { MaterialSizeComparison, SizeSummary, StandardSize } from '../../engine/packing/sizes'
import type { StockUsage } from '../../engine/progress/frozen'
import { BOARD_SIZES, type MaterialResult, type SheetChoice } from '../../engine/types'
import { setRowSize, setRowStockMode, type SizeTarget } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { pct } from '../format'
import { StockEditor } from './StockEditor'

const SIZE_NAME: Record<StandardSize, string> = { saburoku: '3×6', shihachi: '4×8' }

interface Props {
  /** 操作する行（材料の id、組なら2つの材料の id） */
  target: SizeTarget
  /** その行の今の設定（材料の行は Board、組の行は stackChoice） */
  choice: SheetChoice
  /** 行の表示名（読み上げ用） */
  label: string
  /** compareStandardSizes の結果（3×6、4×8 の順の options と、枚数が少ない方・歩留まりが高い方） */
  compare: MaterialSizeComparison | null
  /** 今の設定での結果（自由入力の枚数・歩留まりに使う） */
  current: MaterialResult | null
  /** その行の stockUsage */
  usage: StockUsage | null
}

export function SheetSizePicker({ target, choice, label, compare, current, usage }: Props) {
  const { run } = useCurrentJob()
  const [error, setError] = useState<string | null>(null)
  // 自由入力：手持ちで木取り中（stockOn）か、以前の版の自由入力（大きさだけ）
  const selected: StandardSize | 'free' = choice.stockOn === true || choice.sizeKind === 'custom' ? 'free' : choice.sizeKind
  const isFree = selected === 'free'
  const report = (r: { ok: boolean; message?: string }) => setError(r.ok ? null : (r.message ?? '変えられませんでした'))

  const choose = (kind: StandardSize) => {
    if (selected === kind) return
    const [width, length] = BOARD_SIZES[kind]
    report(run((j) => setRowSize(j, target, { sizeKind: kind, width, length, grain: 'long' })))
  }
  // 計算した結果の無い行（部材がすべて固定した1枚にある）は比較が無いので、数字なしで 3×6・4×8 を出す
  const kinds: StandardSize[] = ['saburoku', 'shihachi']
  const optionOf = (kind: StandardSize): SizeSummary | null => compare?.options.find((o) => o.kind === kind) ?? null
  const chooseFree = () => {
    if (isFree) return
    report(run((j) => setRowStockMode(j, target, true)))
  }

  return (
    <div className="sz">
      <div className="sz-head">
        <span className="kd-k">材料のサイズ（押して選ぶ）</span>
      </div>
      <div className="sz-opts" role="group" aria-label={`材料のサイズ：${label}`}>
        {kinds.map((kind) => {
          const o = optionOf(kind)
          return (
            <button key={kind} type="button" className="sz-opt" aria-pressed={selected === kind} onClick={() => choose(kind)}>
              <span className="sz-name">{SIZE_NAME[kind]}</span>
              {o && compare && (
                <>
                  <span className="sz-n num">{o.sheetCount}枚</span>
                  <span className="sz-y num">{o.sheetCount > 0 ? pct(o.yieldRate) : '―'}</span>
                  <span className="sz-tags">
                    {o.unplacedCount > 0 && <span className="sz-tag err">入らない {o.unplacedCount}</span>}
                    {compare.fewer === kind && <span className="sz-tag ok">枚数が少ない</span>}
                    {compare.higher === kind && <span className="sz-tag ok">歩留まりが高い</span>}
                  </span>
                </>
              )}
            </button>
          )
        })}
        <button type="button" className="sz-opt" aria-pressed={isFree} onClick={chooseFree}>
          <span className="sz-name">自由入力</span>
          {isFree && current ? (
            <>
              <span className="sz-n num">{current.sheetCount}枚</span>
              <span className="sz-y num">{current.sheetCount > 0 ? pct(current.yieldRate) : '―'}</span>
              <span className="sz-tags">
                {current.unplaced.length > 0 && <span className="sz-tag err">入らない {current.unplaced.length}</span>}
              </span>
            </>
          ) : (
            <span className="sz-y sz-muted">手持ち</span>
          )}
        </button>
      </div>
      {error && <p className="msg err">{error}</p>}
      {isFree && <StockEditor target={target} choice={choice} label={label} usage={usage} />}
    </div>
  )
}

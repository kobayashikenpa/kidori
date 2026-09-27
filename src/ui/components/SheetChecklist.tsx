// 1枚ごとのチェックリスト（木取り画面。第1.8版・architecture.md 11.7）。1行＝1片（例：□ 天地板 874×410）。
// 行を押すと、その片の切り出しを付け外しする（最初のチェックでその1枚が固定される）。中身は engine の sheetChecklist の結果をそのまま並べる
import type { SheetChecklistRow } from '../../engine/progress/sheetChecklist'

interface Props {
  /** 読み上げ用（「メラミン 1mm の 1枚目」） */
  label: string
  rows: readonly SheetChecklistRow[]
  /** 行を見分けるキー（押した行の位置を保つのに使う） */
  rowKey: (row: SheetChecklistRow) => string
  onToggle: (row: SheetChecklistRow, key: string, el: HTMLElement) => void
}

export function SheetChecklist({ label, rows, rowKey, onToggle }: Props) {
  const left = rows.filter((r) => !r.done).length
  return (
    <div className="cl">
      <div className="cl-head">
        <h4>切り出しチェック</h4>
        <span className="cl-count num">{left === 0 ? 'すべて切り終わり' : `残り ${left}枚`}</span>
      </div>
      <ul className="cl-list">
        {rows.map((r) => {
          const key = rowKey(r)
          return (
            <li key={r.pieceId}>
              <button
                type="button"
                role="checkbox"
                aria-checked={r.done}
                aria-label={`${label} の ${r.name} ${r.sizeLabel} を切った`}
                data-cl-key={key}
                className={`cl-row${r.done ? ' done' : ''}`}
                onClick={(e) => onToggle(r, key, e.currentTarget)}
              >
                <span className="check-box" aria-hidden="true">
                  {r.done ? '✓' : ''}
                </span>
                <span className="cl-name">{r.name}</span>
                <span className="cl-size num">{r.sizeLabel}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

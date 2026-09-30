// 1枚ごとの切り出しチェック（木取り画面。第2.7版・architecture.md 19.6）。1行＝1部材（例：□ 側板 ×2枚　1810×410）。
// 行を押すと、その1枚の同じ部材の片をまとめて付け外しする（最初のチェックでその1枚が固定される）。
// 中身は engine の sheetPartChecklist の結果をそのまま並べる
import type { SheetPartRow } from '../../engine/progress/sheetChecklist'

interface Props {
  /** 読み上げ用（「メラミン 1mm の 1枚目」） */
  label: string
  rows: readonly SheetPartRow[]
  /** その1枚のチェック済みの片（見出しの「残り ◯枚」に使う） */
  checked: readonly string[]
  /** 行を見分けるキー（押した行の位置を保つのに使う） */
  rowKey: (row: SheetPartRow) => string
  onToggle: (row: SheetPartRow, key: string, el: HTMLElement) => void
}

export function SheetChecklist({ label, rows, checked, rowKey, onToggle }: Props) {
  // 残りは片の数（今までどおり）
  const left = rows.reduce((n, r) => n + r.pieceIds.filter((id) => !checked.includes(id)).length, 0)
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
            <li key={r.partId}>
              <button
                type="button"
                role="checkbox"
                aria-checked={r.done}
                aria-label={`${label} の ${r.name} ${r.pieceIds.length}枚 ${r.sizeLabel} を切った`}
                data-cl-key={key}
                className={`cl-row${r.done ? ' done' : ''}`}
                onClick={(e) => onToggle(r, key, e.currentTarget)}
              >
                <span className="check-box" aria-hidden="true">
                  {r.done ? '✓' : ''}
                </span>
                <span className="cl-name">
                  {r.name}
                  <span className="cl-qty num"> ×{r.pieceIds.length}枚</span>
                </span>
                <span className="cl-size num">{r.sizeLabel}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

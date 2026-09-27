// 切り出しのチェックリスト（木取り画面・材料ごと）。1行＝1部材（フラッシュは部材×表面材）。
// 行を押すと切り出しの完了を付け外しする（setCutChecklistRow）。完了した行はグレーにして、そのまま残す。
// 中身は engine の cuttingChecklist の結果をそのまま並べる
import type { CutChecklistRow } from '../../engine/checklist'
import { Help } from './Help'

interface Props {
  label: string
  rows: readonly CutChecklistRow[]
  onToggle: (row: CutChecklistRow, key: string, el: HTMLElement) => void
}

/** 行を見分けるキー（押した行の位置を保つのに使う） */
function checklistRowKey(row: Pick<CutChecklistRow, 'kind' | 'partId' | 'boardId'>): string {
  return `${row.kind}:${row.partId}:${row.boardId}`
}

export function CutChecklist({ label, rows, onToggle }: Props) {
  const left = rows.filter((r) => !r.done).length
  return (
    <div className="card cl">
      <div className="cl-head">
        <h4>
          <Help title="切り出しチェック">木取り寸法（mm）×枚数。行を押すと切り出しの完了を付け外しします。完了にした部材は、木取りの計算から除きます。</Help>
        </h4>
        <span className="cl-count num">{left === 0 ? 'すべて完了' : `残り ${left}行`}</span>
      </div>
      <ul className="cl-list">
        {rows.map((r) => {
          const key = checklistRowKey(r)
          return (
            <li key={key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={r.done}
                aria-label={`${label} の ${r.partName} ${r.sizeLabel} ${r.count}枚 の切り出し 完了`}
                data-cl-key={key}
                className={`cl-row${r.done ? ' done' : ''}`}
                onClick={(e) => onToggle(r, key, e.currentTarget)}
              >
                <span className="check-box" aria-hidden="true">
                  {r.done ? '✓' : ''}
                </span>
                <span className="cl-name">{r.partName}</span>
                <span className="cl-size num">
                  {r.sizeLabel}
                  <span className="cl-qty"> ×{r.count}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

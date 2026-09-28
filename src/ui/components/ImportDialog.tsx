// 取り込みの確認（第2.4版。architecture.md 16.4・16.5）。共有：1つの仕事／バックアップ：仕事の数と名前
import type { TransferRead } from '../../store/transfer/read'
import { Sheet } from './Sheet'

type Readable = Extract<TransferRead, { ok: true }>

interface Props {
  read: Readable
  /** 保存を止めているときは取り込めない */
  canSave: boolean
  onImport: () => void
  onCancel: () => void
}

export function ImportDialog({ read, canSave, onImport, onCancel }: Props) {
  return (
    <Sheet title="ファイルから取り込む" onClose={onCancel}>
      <div className="stack">
        {read.kind === 'share' && (
          <p style={{ margin: 0 }}>
            共有された仕事：<strong>{read.job.name}</strong>（部材 {read.summary.rows}種類・{read.summary.count}枚）
          </p>
        )}
        <p className="lead" style={{ margin: 0 }}>
          取り込んでも、今の仕事は変わりません（新しい仕事として足します）
        </p>
        {read.notice && <p className="msg warn">{read.notice}</p>}
        {!canSave && <p className="msg err">保存できない状態なので取り込めません</p>}
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={onCancel}>
            やめる
          </button>
          <button type="button" className="btn primary" disabled={!canSave} onClick={onImport}>
            {read.kind === 'share' ? '取り込む' : '追加する'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

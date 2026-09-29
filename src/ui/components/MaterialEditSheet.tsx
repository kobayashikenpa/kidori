// 部材の編集の上に重ねて開く、設定の材料・材料グループの編集（第2.5版。仕様書 4「編集は設定画面で行う」・architecture.md 17.10）。
// 設定の画面と同じ編集の部品（BoardForm・FlushForm）を使う。保存はすぐ設定（仕事の材料・材料グループ）に入る。
// タブは切り替えないので、部材の下書きは残る。削除はここでは出さない（設定の画面で行う）
import { useCurrentJob } from '../../store/useJobStore'
import { BoardForm } from './BoardEditor'
import { FlushForm } from './FlushEditor'
import { Sheet } from './Sheet'

/** 部材の編集から開く、設定の材料・材料グループの編集 */
export type MaterialEditTarget =
  | { kind: 'board'; id: string } // 「編集」：選んでいる材料
  | { kind: 'group'; id: string } // 「編集」：選んでいる材料グループ
  | { kind: 'newGroup' } // 「＋ 材料グループを作る」

interface Props {
  target: MaterialEditTarget
  /** 閉じる。「＋ 材料グループを作る」で作ったときは、その材料グループの id。ほかは null */
  onClose: (createdGroupId: string | null) => void
}

export function MaterialEditSheet({ target, onClose }: Props) {
  const { job } = useCurrentJob()
  const cancel = () => onClose(null)
  const note = (
    <p className="lead" style={{ margin: 0 }}>
      設定を直しています。保存すると、この仕事の設定に入り、部材の編集に戻ります。
    </p>
  )

  if (target.kind === 'board') {
    const board = job.boards.find((b) => b.id === target.id)
    return (
      <Sheet title="設定：材料の編集" onClose={cancel}>
        {note}
        {board ? <BoardForm board={board} done={cancel} /> : <p className="msg err">材料が見つかりません</p>}
      </Sheet>
    )
  }
  if (target.kind === 'group') {
    const flush = job.flushes.find((f) => f.id === target.id)
    return (
      <Sheet title="設定：材料グループの編集" onClose={cancel}>
        {note}
        {flush ? <FlushForm flush={flush} done={cancel} /> : <p className="msg err">材料グループが見つかりません</p>}
      </Sheet>
    )
  }
  return (
    <Sheet title="設定：材料グループの追加" onClose={cancel}>
      {note}
      <FlushForm flush={null} overlay done={(id) => onClose(id)} />
    </Sheet>
  )
}

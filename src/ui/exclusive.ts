// 同じ種類のものは1つだけ開く（説明の吹き出し・数字キーなど）。開くときに、前に開いていたものを閉じる
const current = new Map<string, () => void>()

/** group の中でこれを開いたことにする。前に開いていたものは閉じる。返す関数で登録を外す */
export function claimOpen(group: string, close: () => void): () => void {
  const prev = current.get(group)
  if (prev && prev !== close) prev()
  current.set(group, close)
  return () => {
    if (current.get(group) === close) current.delete(group)
  }
}

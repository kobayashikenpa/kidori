// 仕事の画面。一覧・新しく作る（U-02）は準備中。いま開いている仕事だけを示す
import { bookshelfJob } from '../../engine/fixtures/bookshelf'
import { useJobStore } from '../../store/useJobStore'

export function JobsScreen({ onOpened }: { onOpened: () => void }) {
  const { job, state, addJob, openJob } = useJobStore()

  const openSample = () => {
    const existing = state.jobs.find((j) => j.id === bookshelfJob().id)
    if (existing) {
      openJob(existing.id)
    } else {
      const t = new Date().toISOString()
      addJob({ ...bookshelfJob(), createdAt: t, updatedAt: t }, true)
    }
    onOpened()
  }

  return (
    <section>
      <h2>仕事</h2>
      {job ? (
        <div className="card">
          <div className="lead" style={{ margin: 0 }}>
            いま開いている仕事
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{job.name}</div>
          <div className="lead" style={{ margin: 0 }}>
            部材 {job.parts.length}・板 {job.boards.length}
          </div>
        </div>
      ) : (
        <div className="card stack">
          <p style={{ margin: 0 }}>仕事を開いていません。</p>
          <button type="button" className="btn primary" onClick={openSample}>
            見本（本棚 W900）を開く
          </button>
        </div>
      )}
      <p className="placeholder">仕事の一覧・新しく作る は準備中です</p>
    </section>
  )
}

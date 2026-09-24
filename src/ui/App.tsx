import { useJobStore } from '../store/useJobStore'

export default function App() {
  const { job, state } = useJobStore()
  return (
    <main>
      <h1>kidori 木取り</h1>
      <p>開発中です。</p>
      {state.loadError && <p>{state.loadError}</p>}
      <p>{job ? `開いている仕事：${job.name}（部材 ${job.parts.length}）` : '仕事が開かれていません'}</p>
    </main>
  )
}

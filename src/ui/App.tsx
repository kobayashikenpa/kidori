// 画面の切り替え（下の5つのタブ）。仕事を開いていないときは「仕事」以外を押せない。
// 第2.8版（仕様書 9.3）：一度開いた画面は消さずに隠し（React の Activity）、タブ・開いている段などをそのまま残す。
// 画面ごとのスクロールの位置はメモリに覚えて、戻ったときに戻す（アプリを開いている間だけ）。別の仕事を開いたら一番上から
import { Activity, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useJobStore } from '../store/useJobStore'
import { DimensionScreen } from './screens/DimensionScreen'
import { JobsScreen } from './screens/JobsScreen'
import { KidoriScreen } from './screens/KidoriScreen'
import { PartsScreen } from './screens/PartsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { installTextFieldScroll } from './scroll'

type TabId = 'jobs' | 'parts' | 'dims' | 'kidori' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'jobs', label: '仕事' },
  { id: 'parts', label: '部材' },
  { id: 'dims', label: '寸法表' },
  { id: 'kidori', label: '木取り' },
  { id: 'settings', label: '設定' },
]

export default function App() {
  const { job, state, saveError } = useJobStore()
  const [picked, setPicked] = useState<TabId>(job ? 'parts' : 'jobs')
  // 仕事を開いていなければ、いつも「仕事」を出す
  const tab: TabId = job ? picked : 'jobs'

  // 文字の入力欄（名前・メモなど）を押したら、キーボードに隠れない位置へ動かす（仕様書 9.1）
  useEffect(() => installTextFieldScroll(), [])

  // 画面ごとのスクロールの位置と、一度開いた画面（開いたことのない画面は作らない＝計算しない）
  const scrolls = useRef<Partial<Record<TabId, number>>>({})
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([tab]))
  const jobId = job?.id ?? null
  const [shownJob, setShownJob] = useState(jobId)
  if (shownJob !== jobId) {
    // 別の仕事を開いた（または閉じた）：前の仕事の画面の状態は残さない
    setShownJob(jobId)
    setVisited(new Set([tab]))
  } else if (!visited.has(tab)) setVisited(new Set([...visited, tab]))

  const select = (id: TabId) => {
    if (id === tab) {
      window.scrollTo(0, 0)
      return
    }
    scrolls.current[tab] = window.scrollY
    setPicked(id)
  }
  // 画面を移ったら、その画面の前のスクロールの位置へ（初めての画面は一番上）
  const scrollsOf = useRef(jobId)
  useLayoutEffect(() => {
    if (scrollsOf.current !== jobId) {
      scrollsOf.current = jobId
      scrolls.current = {}
    }
    window.scrollTo(0, scrolls.current[tab] ?? 0)
  }, [tab, jobId])

  /** 一度開いた画面は、隠しても消さない */
  const screen = (id: TabId, node: ReactNode) =>
    visited.has(id) ? (
      <Activity key={`${id}:${jobId ?? ''}`} mode={tab === id ? 'visible' : 'hidden'}>
        {node}
      </Activity>
    ) : null

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">kidori 木取り</span>
        <h1>{job ? job.name : '仕事を開いていません'}</h1>
      </header>
      {state.loadError && <p className="msg err banner">{state.loadError}</p>}
      {saveError && <p className="msg err banner">{saveError}</p>}

      <main>
        {screen('jobs', <JobsScreen onOpened={() => select('parts')} />)}
        {job && screen('parts', <PartsScreen />)}
        {job && screen('dims', <DimensionScreen />)}
        {job && screen('kidori', <KidoriScreen />)}
        {job && screen('settings', <SettingsScreen />)}
      </main>

      <nav className="tabbar" aria-label="画面の切り替え">
        <div className="in">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              disabled={!job && t.id !== 'jobs'}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

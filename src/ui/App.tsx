// 画面の切り替え（下の5つのタブ）。仕事を開いていないときは「仕事」以外を押せない
import { useState } from 'react'
import { useJobStore } from '../store/useJobStore'
import { DimensionScreen } from './screens/DimensionScreen'
import { JobsScreen } from './screens/JobsScreen'
import { KidoriScreen } from './screens/KidoriScreen'
import { PartsScreen } from './screens/PartsScreen'
import { SettingsScreen } from './screens/SettingsScreen'

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

  const select = (id: TabId) => {
    setPicked(id)
    window.scrollTo(0, 0)
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">kidori 木取り</span>
        <h1>{job ? job.name : '仕事を開いていません'}</h1>
      </header>
      {state.loadError && <p className="msg err banner">{state.loadError}</p>}
      {saveError && <p className="msg err banner">{saveError}</p>}

      <main>
        {tab === 'jobs' && <JobsScreen onOpened={() => select('parts')} />}
        {job && tab === 'parts' && <PartsScreen />}
        {job && tab === 'dims' && <DimensionScreen />}
        {job && tab === 'kidori' && <KidoriScreen />}
        {job && tab === 'settings' && <SettingsScreen />}
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

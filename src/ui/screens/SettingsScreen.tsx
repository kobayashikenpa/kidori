// 設定の画面：刃厚・耳落とし・切り代・切り方、板の一覧、配色
import { useState } from 'react'
import type { Board, Settings } from '../../engine/types'
import { boardLabel, boardSizeLabel, partsUsingBoard, updateSettings } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { BoardEditor } from '../components/BoardEditor'
import { NumberField } from '../components/NumberField'
import { Segmented } from '../components/Segmented'
import { CUT_MODE_HINT, CUT_MODES } from '../cutModes'
import { loadTheme, saveTheme, type ThemeChoice } from '../theme'

/** 切り代のよく使う値（暫定：未決事項 12） */
const ALLOWANCE_PRESETS = [0, 5, 10]

export function SettingsScreen() {
  const { job, run } = useCurrentJob()
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme)
  const [editing, setEditing] = useState<Board | 'new' | null>(null)
  const s = job.settings

  const set = (patch: Partial<Settings>) => {
    const r = run((j) => updateSettings(j, patch))
    setError(r.ok ? null : r.message)
  }

  return (
    <section>
      <h2>設定</h2>
      <p className="lead">この仕事だけに効く設定です。</p>
      {error && <p className="msg err">{error}</p>}

      <div className="card stack">
        <div className="field">
          <label className="label" htmlFor="set-kerf">
            刃厚
          </label>
          <NumberField id="set-kerf" value={s.kerf} onChange={(v) => v !== null && set({ kerf: v })} />
          <span className="hint">1回切るごとに刃で削れて消える幅</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="set-trim">
            耳落とし
          </label>
          <NumberField id="set-trim" value={s.trim} onChange={(v) => v !== null && set({ trim: v })} />
          <span className="hint">板を縦長に置いたときの、右側の長辺だけを落とします</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="set-allowance">
            切り代（初期値）
          </label>
          <div className="seg" role="group" aria-label="切り代のよく使う値">
            {ALLOWANCE_PRESETS.map((v) => (
              <button key={v} type="button" aria-pressed={s.allowance === v} onClick={() => set({ allowance: v })}>
                {v}mm
              </button>
            ))}
          </div>
          <NumberField
            id="set-allowance"
            value={s.allowance}
            onChange={(v) => v !== null && set({ allowance: v })}
          />
          <span className="hint">仕上がり寸法に足す、あとで削り仕上げるための余分。部材ごとに変えられます</span>
        </div>

        <div className="field">
          <span className="label">切り方</span>
          <Segmented ariaLabel="切り方" value={s.cutMode} options={CUT_MODES} onChange={(v) => set({ cutMode: v })} />
          <span className="hint">{CUT_MODE_HINT[s.cutMode]}</span>
        </div>
      </div>

      <h3>板</h3>
      <div className="stack">
        {job.boards.length === 0 && <p className="lead">板がまだありません。</p>}
        {job.boards.map((b) => {
          const users = partsUsingBoard(job, b.id)
          return (
            <button key={b.id} type="button" className="card board-item" onClick={() => setEditing(b)}>
              <span className="board-name">{boardLabel(b)}</span>
              <span className="lead num" style={{ margin: 0 }}>
                {boardSizeLabel(b)}・木目 {b.grain === 'long' ? '長辺方向' : '短辺方向'}
              </span>
              <span className="lead" style={{ margin: 0 }}>
                {users.length > 0 ? `使っている部材：${users.join('・')}` : '使っている部材なし'}
              </span>
            </button>
          )
        })}
        <button type="button" className="btn ghost" onClick={() => setEditing('new')}>
          ＋ 板を追加
        </button>
      </div>
      {editing && (
        <BoardEditor
          key={editing === 'new' ? 'new' : editing.id}
          board={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <h3>配色</h3>
      <Segmented<ThemeChoice>
        ariaLabel="配色"
        value={theme}
        options={[
          { value: 'auto', label: '端末に合わせる' },
          { value: 'light', label: 'ライト' },
          { value: 'dark', label: 'ダーク' },
        ]}
        onChange={(v) => {
          setTheme(v)
          saveTheme(v)
        }}
      />
    </section>
  )
}

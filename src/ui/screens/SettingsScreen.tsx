// 設定の画面：刃厚・耳落とし・切り代・切り方、逃げの一覧、板の一覧、配色
import { useState } from 'react'
import type { Settings } from '../../engine/types'
import { updateSettings } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { BoardEditor } from '../components/BoardEditor'
import { NigeEditor } from '../components/NigeEditor'
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
  const s = job.settings

  const set = (patch: Partial<Settings>) => {
    const r = run((j) => updateSettings(j, patch))
    setError(r.ok ? null : r.message)
  }

  return (
    <section>
      <h2>設定</h2>
      <p className="lead">この仕事だけに効く設定です。新しい仕事には、最後に変えた設定が引き継がれます。</p>
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
            端切り
          </label>
          <NumberField id="set-trim" value={s.trim} onChange={(v) => v !== null && set({ trim: v })} />
          <span className="hint">刃厚を含む幅です。縦切り優先は右側の長手を、横切り優先は上側の長手と右側の妻手を落とします</span>
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

      <h3>逃げ</h3>
      <NigeEditor />

      <h3>材料</h3>
      <BoardEditor />

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

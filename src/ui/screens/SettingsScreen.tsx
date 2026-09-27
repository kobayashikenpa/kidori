// 設定の画面：刃厚・耳落とし・切り代・切り方、調整寸法（逃げ・ほぞなど）の一覧、板の一覧、配色
import { useState } from 'react'
import type { Settings } from '../../engine/types'
import { updateSettings } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { BoardEditor } from '../components/BoardEditor'
import { FlushEditor } from '../components/FlushEditor'
import { Help } from '../components/Help'
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
      <h2>
        <Help title="設定">この仕事だけに効く設定です。新しい仕事には、最後に変えた設定が引き継がれます。</Help>
      </h2>
      {error && <p className="msg err">{error}</p>}

      <div className="card stack">
        <div className="field">
          <Help className="label" title="刃厚">
            1回切るごとに刃で削れて消える幅
          </Help>
          <NumberField ariaLabel="刃厚" value={s.kerf} onChange={(v) => v !== null && set({ kerf: v })} />
        </div>

        <div className="field">
          <Help className="label" title="端切り">
            刃厚を含む幅です。縦切り優先は右側の長手を、横切り優先は上側の長手と右側の妻手を落とします
          </Help>
          <NumberField ariaLabel="端切り" value={s.trim} onChange={(v) => v !== null && set({ trim: v })} />
        </div>

        <div className="field">
          <Help className="label" title="切り代（フラッシュのみ）">
            フラッシュの部材だけに足します（ほかの部材は 0）。仕上がり寸法に足す、あとで削り仕上げるための余分。部材ごとに変えられます
          </Help>
          <div className="seg" role="group" aria-label="切り代のよく使う値">
            {ALLOWANCE_PRESETS.map((v) => (
              <button key={v} type="button" aria-pressed={s.allowance === v} onClick={() => set({ allowance: v })}>
                {v}mm
              </button>
            ))}
          </div>
          <NumberField
            ariaLabel="切り代（フラッシュのみ）"
            value={s.allowance}
            onChange={(v) => v !== null && set({ allowance: v })}
          />
        </div>

        <div className="field">
          <Help className="label" title="切り方">
            {CUT_MODE_HINT[s.cutMode]}
          </Help>
          <Segmented ariaLabel="切り方" value={s.cutMode} options={CUT_MODES} onChange={(v) => set({ cutMode: v })} />
        </div>
      </div>

      <h3>
        <Help title="調整寸法">
          逃げ・ほぞなど、仕上がり寸法を伸ばしたり短くしたりする寸法です。式の中で足したり引いたりして使います（例：天地板.W − 逃げ1、棚板.D + ほぞ15）。名前や寸法を変えると、使っている式もついてきます。
        </Help>
      </h3>
      <NigeEditor />

      <h3>
        <Help title="材料">材料名と厚みで区別します。材料のサイズ（3×6・4×8）は木取りの画面で選びます。</Help>
      </h3>
      <BoardEditor />

      <h3>
        <Help title="フラッシュ">
          芯材の両面に表面材を貼って厚みを作る部材のための登録です。部材の「材料」の欄で選べます。表面材は材料ごとに木取りし、芯材は木取りに入れません。「表面材を重ねて切る」にすると、2種類の表面材を1枚ずつ重ねて1回で切ります（表面材が2種類で枚数が同じとき。2つの材料のサイズと木目がそろっていないと重ねずに木取りします）。
        </Help>
      </h3>
      <FlushEditor />

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

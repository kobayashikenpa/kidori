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
        <Help title="設定">この仕事だけに効く設定です。新しい仕事は、いつも初めの設定から始まります（仕事をコピーしたときは、元の仕事の設定のまま）。</Help>
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
            刃厚を含む幅です。縦切り優先は右側の長手を、横切り優先は下側の長手と右側の妻手を落とします
          </Help>
          <NumberField ariaLabel="端切り" value={s.trim} onChange={(v) => v !== null && set({ trim: v })} />
        </div>

        <div className="field">
          <Help className="label" title="切り代（材料グループのみ）">
            材料グループの部材だけに足します（材料の部材は 0）。仕上がり寸法に足す、あとで削り仕上げるための余分。部材ごとに変えられます
          </Help>
          <div className="seg" role="group" aria-label="切り代のよく使う値">
            {ALLOWANCE_PRESETS.map((v) => (
              <button key={v} type="button" aria-pressed={s.allowance === v} onClick={() => set({ allowance: v })}>
                {v}mm
              </button>
            ))}
          </div>
          <NumberField
            ariaLabel="切り代（材料グループのみ）"
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
        <Help title="材料">
          材料名と厚みで区別します。材料のサイズ（3×6・4×8）は木取りの画面で選びます。「木取りしない」を付けた材料（例：芯材・桟の枠など、パネルソーで切らないもの）は、厚みの計算には使いますが、木取りの計算には入りません。
        </Help>
      </h3>
      <BoardEditor />

      <h3>
        <Help title="材料グループ">
          材料を組み合わせたものです（例：フラッシュ25 ＝ 芯材15×1 ＋ メラミン1×2 ＋ ラワン4×2）。厚みは中身の合計です。部材の「材料」の欄で選べ、木取りする中身ごとに木取りします（木取りしない材料は入れません）。重ね切りは木取りの画面で、仕事ごとに切り替えます。
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

      <h3>使い方</h3>
      <a
        className="btn"
        href="https://github.com/kobayashikenpa/kidori/blob/main/docs/manual.md"
        target="_blank"
        rel="noopener noreferrer"
      >
        取扱説明書を開く
      </a>
    </section>
  )
}

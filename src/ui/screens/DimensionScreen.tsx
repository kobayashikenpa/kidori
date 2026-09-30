// 寸法表の画面：1部材1行の表（DimensionTable）。上のタブ（第2.8版。仕様書 9.3）で
// ［木取り］＝木取り寸法と部材ごとの切り出しの進み具合（読むだけ）、［仕上がり］＝仕上がり寸法と仕上がりの完了 を切り替える。
// 選んだタブは端末ごとに覚える（dimensionTab.ts）
import { useMemo, useState } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { partCutProgress } from '../../engine/progress/partProgress'
import { setPartChecks } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { DimensionTable } from '../components/DimensionTable'
import { Help } from '../components/Help'
import { Segmented } from '../components/Segmented'
import { DIMENSION_TABS, loadDimensionTab, saveDimensionTab, type DimensionTab } from '../dimensionTab'

export function DimensionScreen() {
  const { job, run } = useCurrentJob()
  const dims = useMemo(() => computeDimensions(job), [job])
  const progress = useMemo(() => partCutProgress(job), [job])
  const [tab, setTab] = useState<DimensionTab>(loadDimensionTab)
  const pieces = job.parts.reduce((n, p) => n + p.quantity, 0)

  return (
    <section>
      <h2>
        <Help title="寸法表">
          上のタブで表を切り替えます。［木取り］は木取り寸法（仕上がり寸法に切り代を足した、パネルソーで切る寸法。切り代は材料グループの部材だけ）と、
          右に部材ごとの切り出しの進み具合（切った数/切り出す数）です。切り出しのチェックは木取りの画面で付けます。
          ［仕上がり］は仕上がり寸法（家具として仕上げる寸法）で、右の「完了」を押すと仕上がりの完了を付けられます（完了した行はグレー）。
          数字を押すと内訳が開きます。
        </Help>
      </h2>
      <div className="dim-tabs">
        <Segmented
          ariaLabel="寸法表の表"
          value={tab}
          options={[...DIMENSION_TABS]}
          onChange={(v) => {
            setTab(v)
            saveDimensionTab(v)
          }}
        />
      </div>
      <p className="lead">
        部材 {job.parts.length}種類・合計 {pieces}枚。
      </p>
      <DimensionTable
        key={tab}
        job={job}
        dims={dims.parts}
        mode={tab}
        progress={progress}
        onCheck={(partId, patch) => run((j) => setPartChecks(j, partId, patch))}
      />
    </section>
  )
}

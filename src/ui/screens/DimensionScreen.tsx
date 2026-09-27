// 寸法表の画面：1部材1行の表（DimensionTable）。仕上がり寸法と仕上がりの完了だけを出す。
// 木取り寸法と切り出しの完了は木取り画面で見る（仕様書 9「寸法表の表」）
import { useMemo } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { setPartChecks } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { DimensionTable } from '../components/DimensionTable'
import { Help } from '../components/Help'

export function DimensionScreen() {
  const { job, run } = useCurrentJob()
  const dims = useMemo(() => computeDimensions(job), [job])
  const pieces = job.parts.reduce((n, p) => n + p.quantity, 0)

  return (
    <section>
      <h2>
        <Help title="寸法表">
          仕上がり寸法（家具として仕上げる寸法）を部材ごとに並べています。青の数字を押すと内訳が開きます。
          右の「完了」を押すと仕上がりの完了を付けられます（完了した行はグレー）。
          木取り寸法と切り出しの完了は木取り画面で見ます。
        </Help>
      </h2>
      <p className="lead">
        部材 {job.parts.length}種類・合計 {pieces}枚。
      </p>
      <DimensionTable
        job={job}
        dims={dims.parts}
        onCheck={(partId, patch) => run((j) => setPartChecks(j, partId, patch))}
      />
    </section>
  )
}

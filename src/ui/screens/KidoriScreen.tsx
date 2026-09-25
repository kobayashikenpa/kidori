// 木取りの画面：材料（材料名＋厚み）ごとの必要な材料の枚数・歩留まり・切り方、全体の歩留まり、
// 入らない部材・計算できない部材の一覧、板ごとの結果。計算はすべて engine（computeDimensions → packJob）
import { useMemo } from 'react'
import { computeDimensions } from '../../engine/dimensions'
import { packJob } from '../../engine/packing'
import type { BoardGrain, MaterialResult, PackingResult, SheetLayout } from '../../engine/types'
import { boardLabel, updateSettings } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { CutSteps } from '../components/CutSteps'
import { Segmented } from '../components/Segmented'
import { SheetDiagram } from '../components/SheetDiagram'
import { CUT_MODE_HINT, CUT_MODES, cutModeLabel } from '../cutModes'
import { fmt, pct } from '../format'

const SKIP_REASON: Record<PackingResult['skipped'][number]['reason'], string> = {
  noBoard: '材料が未設定',
  dimensionError: '寸法を計算できない',
  noThickness: '厚みが決まらない（部材の画面で厚みを選んでください）',
}

export function KidoriScreen() {
  const { job, run } = useCurrentJob()
  const result = useMemo(() => packJob(job, computeDimensions(job)), [job])
  const s = job.settings
  const unplaced = result.materials.flatMap((m) => m.unplaced.map((u) => ({ ...u, board: boardLabel(m) })))
  const empty = result.materials.length === 0
  const colorOf = (partId: string) => Math.max(0, job.parts.findIndex((p) => p.id === partId))
  const grainOf = (boardId: string): BoardGrain => job.boards.find((b) => b.id === boardId)?.grain ?? 'long'

  return (
    <section>
      <h2>木取り</h2>
      <p className="lead num">
        刃厚 {fmt(s.kerf)}mm・端切り {fmt(s.trim)}mm・切り代 {fmt(s.allowance)}mm（設定の画面で変えられます）
      </p>

      <div className="field">
        <span className="label">切り方</span>
        <Segmented
          ariaLabel="切り方"
          value={s.cutMode}
          options={CUT_MODES}
          onChange={(v) => run((j) => updateSettings(j, { cutMode: v }))}
        />
        <span className="hint">{CUT_MODE_HINT[s.cutMode]}</span>
      </div>

      {empty ? (
        <div className="card placeholder" style={{ marginTop: 14 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>切り出す部材がありません</p>
          <p style={{ margin: '6px 0 0' }}>部材の画面で、枚数と材料を入れてください。</p>
        </div>
      ) : (
        <div className="card kd-summary" style={{ marginTop: 14 }}>
          <div className="kd-total">
            <span className="kd-total-label">全体の歩留まり</span>
            <span className="kd-total-value num">{pct(result.totalYieldRate)}</span>
          </div>
          <ul className="kd-mats">
            {result.materials.map((m) => (
              <MaterialRow key={m.boardId} m={m} auto={s.cutMode === 'auto'} />
            ))}
          </ul>
        </div>
      )}

      {unplaced.length > 0 && (
        <div className="card kd-issues err" role="alert">
          <h4>材料に収まらない部材</h4>
          <p className="band-note">どう回しても材料の使える範囲（端切りの後）に収まりません。寸法か材料を見直してください。</p>
          <ul>
            {unplaced.map((u) => (
              <li key={u.partId}>
                <b>{u.name}</b>（{u.board}）
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.skipped.length > 0 && (
        <div className="card kd-issues warn">
          <h4>計算から外した部材</h4>
          <p className="band-note">部材の画面で直すと、木取りに入ります。</p>
          <ul>
            {result.skipped.map((k) => (
              <li key={k.partId}>
                <b>{k.name}</b>：{SKIP_REASON[k.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.materials
        .filter((m) => m.sheets.length > 0)
        .map((m) => (
          <section key={m.boardId} aria-label={boardLabel(m)}>
            <h3>
              {boardLabel(m)}
              <span className="kd-h3-sub num">
                {m.sheetCount}枚・{cutModeLabel(m.mode)}
              </span>
            </h3>
            <div className="stack">
              {m.sheets.map((sh) => (
                <SheetCard
                  key={sh.index}
                  sheet={sh}
                  count={m.sheetCount}
                  grain={grainOf(m.boardId)}
                  trim={s.trim}
                  colorOf={colorOf}
                />
              ))}
            </div>
          </section>
        ))}
    </section>
  )
}

function MaterialRow({ m, auto }: { m: MaterialResult; auto: boolean }) {
  return (
    <li className="kd-mat">
      <div className="kd-mat-name">{boardLabel(m)}</div>
      <div className="kd-mat-nums">
        <span>
          <span className="kd-k">必要な材料</span>
          <span className="kd-v num">{m.sheetCount}枚</span>
        </span>
        <span>
          <span className="kd-k">歩留まり</span>
          <span className="kd-v num">{m.sheetCount > 0 ? pct(m.yieldRate) : '―'}</span>
        </span>
      </div>
      {m.sheetCount > 0 && (
        <div className="kd-mat-mode">
          切り方：<b>{cutModeLabel(m.mode)}</b>
          {auto && <span className="chip ok">おまかせで選択</span>}
        </div>
      )}
    </li>
  )
}

interface SheetCardProps {
  sheet: SheetLayout
  count: number
  grain: BoardGrain
  trim: number
  colorOf: (partId: string) => number
}

function SheetCard({ sheet, count, grain, trim, colorOf }: SheetCardProps) {
  const landscape = sheet.orientation === 'landscape'
  // 図の上で木目の線が横に通るか（横長で長手方向、または縦長で妻手方向）
  const grainAcross = (grain === 'long') === landscape
  return (
    <article className="card kd-sheet">
      <header className="kd-sheet-head">
        <span className="kd-sheet-no">
          {sheet.index}枚目<span className="kd-of"> / {count}枚</span>
        </span>
        <span className="kd-sheet-yield num">歩留まり {pct(sheet.yieldRate)}</span>
      </header>
      <p className="band-note num">
        材料 {fmt(sheet.boardWidth)}×{fmt(sheet.boardLength)}・部材 {sheet.placements.length}枚・端材{' '}
        {sheet.scraps.length}枚
      </p>
      <SheetDiagram sheet={sheet} grain={grain} colorOf={colorOf} />
      <p className="dg-legend">
        {sheet.trims.length > 0 && (
          <span>
            <i className="dg-key trim" />
            端切り {fmt(trim)}mm（{landscape ? '上・右' : '右'}）
          </span>
        )}
        <span>
          <i className="dg-key scrap" />
          端材
        </span>
        <span>
          <i className={`dg-key grain ${grainAcross ? 'across' : 'down'}`} />
          木目：{grain === 'long' ? '長手方向' : '妻手方向'}
        </span>
        <span>部材は右上から詰める・部材の寸法は木取り寸法・端材は 横×縦</span>
      </p>
      <CutSteps sheet={sheet} />
    </article>
  )
}

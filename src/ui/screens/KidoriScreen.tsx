// 木取りの画面：材料（材料名＋厚み）ごとの必要な材料の枚数・歩留まり・切り方、全体の歩留まり、
// 入らない部材・計算できない部材の一覧、材料ごとに 固定した1枚 → 計算した1枚 の順で1枚ごとの配置図とチェックリスト（第1.8版）。
// 計算はすべて engine（computeDimensions → packJob・frozenSheetViews・materialSummaries・sheetPartChecklist）。
// 重ね切り（第2.0版。architecture.md 12.8）：組の段は材料の段より前（第2.8版）。組の1枚のチェックは stackWith を付けて両方の材料に数える
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { orderedBoards } from '../../engine/boards'
import { computeDimensions } from '../../engine/dimensions'
import { packJob } from '../../engine/packing'
import { stackKey, stackLabel, stackPairName } from '../../engine/packing/stack'
import { stackedSheetId, stackSheetNumbers } from '../../engine/packing/offcuts'
import { stackChoice, usesStock } from '../../engine/packing/stock'
import { stockShortage } from '../../engine/hints/shortage'
import { compareStandardSizes, type MaterialSizeComparison } from '../../engine/packing/sizes'
import {
  frozenSheetViews,
  layoutSizeLabel,
  materialSizeCounts,
  materialSummaries,
  stockUsage,
  type FrozenSheetView,
  type MaterialSummary,
  type SizeCount,
  type StockUsage,
} from '../../engine/progress/frozen'
import { sheetProgress, type SheetProgress } from '../../engine/progress/sheetProgress'
import { partCutProgress } from '../../engine/progress/partProgress'
import { sheetPartChecklist, type SheetPartRow } from '../../engine/progress/sheetChecklist'
import type { Board, BoardGrain, MaterialResult, PackingResult, SheetChoice, SheetLayout } from '../../engine/types'
import { boardTokenLabel } from '../../engine/defaults'
import { boardLabel, clearLegacyCut, newId, setPartCheck, setStacking, updateSettings, type SheetTarget } from '../../store/jobs'
import { useCurrentJob } from '../../store/useJobStore'
import { SavingHints } from '../components/SavingHints'
import { Segmented } from '../components/Segmented'
import { SheetChecklist } from '../components/SheetChecklist'
import { SheetDiagram } from '../components/SheetDiagram'
import { SheetSizePicker } from '../components/SheetSizePicker'
import { StockShortageNotice } from '../components/StockShortageNotice'
import { CUT_MODE_HINT, CUT_MODES, cutModeLabel } from '../cutModes'
import { fmt, pct } from '../format'
import { Help } from '../components/Help'

const STACKING_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'オン' },
  { value: 'off', label: 'オフ' },
]

const SKIP_REASON: Record<PackingResult['skipped'][number]['reason'], string> = {
  noBoard: '材料が未設定',
  dimensionError: '寸法を計算できない',
  thicknessMismatch: '厚みの寸法が材料の厚みと合わない',
  noThickness: '厚みが決まらない（部材の画面で厚みを選んでください）',
}

/** 画面に出す1枚（固定した1枚、または計算した1枚） */
interface SheetEntry {
  /** React のキー */
  key: string
  layout: SheetLayout
  target: SheetTarget
  checked: readonly string[]
  grain: BoardGrain
  trim: number
  /** 済んだ工程・次の工程・残りの材料 */
  progress: SheetProgress
  /** 固定した1枚なら表示用のまとめ */
  view: FrozenSheetView | null
  /** 1枚の名前（重ねた板は「重ねた板1」）。ふつうの1枚は null（「◯枚目」で出す） */
  name: string | null
}

/** 材料ごとの段（重ね切りの組の段もここに入る） */
interface Section {
  /** 材料の id、組なら stackKey */
  boardId: string
  /** 重ね切りの組の2つの材料（組の段だけ） */
  stack: [string, string] | null
  label: string
  summary: MaterialSummary
  mode: 'vertical' | 'horizontal' | null
  sheets: SheetEntry[]
  /** 切り終わった1枚（通常の一覧には出さない） */
  finished: SheetEntry[]
  /** その行のサイズの設定（材料の行は材料、組の行は stackChoice）。材料が仕事に無ければ null */
  choice: SheetChoice | null
  /** その行の手持ちで木取りする（第2.3版：組は組の行の設定）。1枚ごとに大きさを添え、まとめはサイズ別の枚数 */
  stocked: boolean
}

const DRIFT_REASON: Record<FrozenSheetView['drift'][number]['reason'], string> = {
  size: '寸法',
  count: '枚数',
  removed: '部材の削除・材料の変更',
}

/** 端材から取った1枚（第2.6版）か。枚数に数えない */
const isOffcut = (e: SheetEntry): boolean => e.layout.sheet?.offcut !== undefined
/** 「◯枚目 / ◯枚」の番号は、端材から取った1枚・重ねた板を除いて振る */
const plainCount = (list: SheetEntry[]): number => list.filter((e) => !e.name).length
const plainNo = (list: SheetEntry[], e: SheetEntry): number => list.filter((x) => !x.name).indexOf(e) + 1
/** 段の見出しの枚数。端材から取った1枚は「（端材から ◯枚）」で添える */
const sheetCountText = (list: SheetEntry[]): string => {
  const off = list.filter(isOffcut).length
  return `${list.length - off}枚${off > 0 ? `（端材から ${off}枚）` : ''}`
}

const frozenEntry = (v: FrozenSheetView, name: string | null): SheetEntry => ({
  key: v.sheet.id,
  layout: v.sheet.layout,
  target: { kind: 'frozen', sheetId: v.sheet.id },
  checked: v.sheet.checked,
  grain: v.sheet.grain,
  trim: v.sheet.trim,
  progress: v.progress,
  view: v,
  name,
})

export function KidoriScreen() {
  const { job, run } = useCurrentJob()
  // 今の結果、3×6・4×8 の比較（材料のサイズの選択）、固定した1枚の表示用のまとめ。どれも仕事が変わったときだけ計算し直す
  const { result, compare, views, summaries, usage, sizeCounts, shortages, progress } = useMemo(() => {
    const dims = computeDimensions(job)
    const result = packJob(job, dims)
    const views = frozenSheetViews(job, dims)
    return {
      result,
      compare: compareStandardSizes(job, dims),
      views,
      summaries: materialSummaries(job, result, views),
      usage: stockUsage(job, result),
      sizeCounts: materialSizeCounts(job, result, views),
      // 手持ちが足りない材料の解決策（足りない材料が無ければ packJob を追加で呼ばない）
      shortages: stockShortage(job, dims, result),
      // 部材ごとの切り出しの進み具合（第2.7版）
      progress: partCutProgress(job),
    }
  }, [job])
  // チェックを付け外しすると上の集計や1枚の並びが変わるので、押した行が画面の同じ位置に残るようにスクロールを戻す。
  // 押した行が消えたとき（その1枚が切り終わり）は、材料の段の見出しを同じ位置に残す
  const anchor = useRef<{ keys: string[]; tops: number[] } | null>(null)
  useLayoutEffect(() => {
    const a = anchor.current
    if (!a) return
    anchor.current = null
    for (let i = 0; i < a.keys.length; i++) {
      const el = document.querySelector<HTMLElement>(`[data-cl-key="${CSS.escape(a.keys[i])}"]`)
      if (!el) continue
      const delta = el.getBoundingClientRect().top - a.tops[i]
      if (Math.abs(delta) > 1) window.scrollBy(0, delta)
      return
    }
  }, [job])
  const toggle = (boardId: string, entry: SheetEntry, row: SheetPartRow, key: string, el: HTMLElement) => {
    // 計算した1枚は、ここで決めた id で固定される（押した行のキーが、固定した1枚の行のキーになる）
    const id = entry.target.kind === 'frozen' ? entry.target.sheetId : newId('sheet')
    const after = `${id}:${row.partId}`
    const sec = document.querySelector<HTMLElement>(`[data-cl-key="${CSS.escape(`sec:${boardId}`)}"]`)
    const top = el.getBoundingClientRect().top
    anchor.current = {
      keys: [after, key, `sec:${boardId}`],
      tops: [top, top, sec?.getBoundingClientRect().top ?? 0],
    }
    const r = run((j) => setPartCheck(j, entry.target, row.partId, !row.done, new Date(), id))
    if (!r.ok) anchor.current = null
  }
  // 「切り終わり ◯枚」を開いている材料
  const [openFinished, setOpenFinished] = useState<Record<string, boolean>>({})
  const s = job.settings
  // 部材ごとに切り代を入れた部材（設定の切り代を変えても変わらないことを見せる）
  const own = job.parts.filter((p) => p.quantity > 0 && p.allowance !== null)
  const unplaced = result.materials.flatMap((m) => m.unplaced.filter((u) => u.reason !== 'noStock').map((u) => ({ ...u, board: boardLabel(m) })))
  const empty = summaries.materials.length === 0
  const colorOf = (partId: string) => Math.max(0, job.parts.findIndex((p) => p.id === partId))
  const boardOf = (boardId: string): Board | null => job.boards.find((b) => b.id === boardId) ?? null
  const resultOf = (boardId: string): MaterialResult | null => result.materials.find((m) => m.boardId === boardId) ?? null

  // 材料ごとの段：材料の表示の並び（orderedBoards）。材料を削除した固定した1枚は最後に、写しの材料名で。
  // 重ね切りの組の段は、すべて材料の段より前（第2.8版）。組どうしは1つ目の材料の並び（1つ目の材料が無い組は組の最後）
  const groupRows = summaries.materials.filter((m) => m.stack)
  const stackNo = new Map(stackSheetNumbers(job, result.materials).map((x) => [x.id, x.number]))
  const plainOrder = [
    ...orderedBoards(job).map((b) => b.id),
    ...summaries.materials.filter((m) => !m.stack && !job.boards.some((b) => b.id === m.boardId)).map((m) => m.boardId),
  ]
  const order = [
    ...plainOrder.flatMap((id) => groupRows.filter((g) => g.stack?.boardIds[0] === id).map((g) => g.boardId)),
    ...groupRows.filter((g) => !plainOrder.includes(g.stack?.boardIds[0] ?? '')).map((g) => g.boardId),
    ...plainOrder,
  ]
  const sections: Section[] = order.flatMap((boardId) => {
    const summary = summaries.materials.find((m) => m.boardId === boardId)
    if (!summary) return []
    const pair = summary.stack?.boardIds ?? null
    const board = boardOf(pair ? pair[0] : boardId)
    const m = resultOf(boardId)
    // 組の行は組の設定（第2.3版。1つ目の材料の設定ではない）
    const choice: SheetChoice | null = pair ? (board && boardOf(pair[1]) ? stackChoice(job, pair) : null) : board
    const mine = views.filter((v) =>
      pair
        ? v.sheet.stackWith !== undefined && stackKey(v.sheet.boardId, v.sheet.stackWith.boardId) === boardId
        : v.sheet.boardId === boardId && !v.sheet.stackWith,
    )
    // 重ねた板の名前「重ねた板1」（番号は engine の stackSheetNumbers）
    // 端材から取った1枚は「重ねた板1の端材（メラミン1）780×1800」（短辺×長辺）
    const token = board ? boardTokenLabel(board) : (mine[0]?.label ?? '')
    const nameOf = (id: string, layout: SheetLayout): string | null => {
      const src = layout.sheet?.offcut?.source
      if (!pair && src !== undefined) {
        const a = Math.min(layout.boardWidth, layout.boardLength)
        const b = Math.max(layout.boardWidth, layout.boardLength)
        return `重ねた板${src}の端材（${token}）${fmt(a)}×${fmt(b)}`
      }
      const n = pair ? stackNo.get(id) : undefined
      return n === undefined ? null : `重ねた板${n}`
    }
    const frozen = mine.filter((v) => !v.complete).map((v) => frozenEntry(v, nameOf(v.sheet.id, v.sheet.layout)))
    const computed: SheetEntry[] = (m?.sheets ?? []).map((sh) => ({
      key: `c${boardId}:${sh.index}`,
      layout: sh,
      target: pair
        ? { kind: 'computed', boardId: pair[0], stackWith: pair[1], mode: m?.mode ?? 'vertical', layout: sh }
        : { kind: 'computed', boardId, mode: m?.mode ?? 'vertical', layout: sh },
      checked: [],
      grain: sh.sheet?.grain ?? board?.grain ?? 'long',
      trim: s.trim,
      progress: sheetProgress(sh, s.kerf, []),
      view: null,
      name: nameOf(stackedSheetId(boardId, sh), sh),
    }))
    return [
      {
        boardId,
        stack: pair,
        // 組の名前は材料が2つともあれば今の名前、無ければ固定した1枚の写しの名前
        label: pair
          ? board && boardOf(pair[1])
            ? stackLabel(job, pair)
            : (mine[0]?.label ?? stackLabel(job, pair))
          : board
            ? boardLabel(board)
            : (mine[0]?.label ?? ''),
        summary,
        mode: m && m.sheets.length > 0 ? m.mode : (mine[0]?.sheet.mode ?? null),
        sheets: [...frozen, ...computed],
        finished: mine.filter((v) => v.complete).map((v) => frozenEntry(v, nameOf(v.sheet.id, v.sheet.layout))),
        choice,
        stocked: choice !== null && usesStock(choice),
      },
    ]
  })

  return (
    <section>
      <h2>
        <Help title="木取り">
          刃厚・端切り・切り代は設定の画面で変えられます。部材ごとに切り代を入れた部材は、設定の切り代を変えてもその値のままです。
          部材を切ったら、配置図の下のチェックを押します。1つ目のチェックで、その1枚の並びは固定されます。
        </Help>
      </h2>
      <p className="lead num">
        刃厚 {fmt(s.kerf)}mm・端切り {fmt(s.trim)}mm・切り代（材料グループ） {fmt(s.allowance)}mm
      </p>
      {own.length > 0 && (
        <p className="lead num">
          部材ごとに切り代を入れた部材：{own.map((p) => `${p.name} ${fmt(p.allowance ?? 0)}mm`).join('・')}
        </p>
      )}

      <div className="field">
        <Help className="label" title="切り方">
          {CUT_MODE_HINT[s.cutMode]}
        </Help>
        <Segmented
          ariaLabel="切り方"
          value={s.cutMode}
          options={CUT_MODES}
          onChange={(v) => run((j) => updateSettings(j, { cutMode: v }))}
        />
      </div>

      <div className="field">
        <Help className="label" title="重ね切り（2枚重ね）">
          材料グループの部材で、違う材料の同じ片を2枚重ねて1回で切ります（例：メラミン1＋ラワン4）。同じ材料どうしは重ねません。
          重ねると材料が増えるときは重ねません。重ねた板の端材は、ほかの部材に使います。
        </Help>
        <Segmented
          ariaLabel="重ね切り（2枚重ね）"
          value={job.stacking}
          options={STACKING_OPTIONS}
          onChange={(v) => run((j) => setStacking(j, v))}
        />
      </div>

      {empty ? (
        <div className="card placeholder" style={{ marginTop: 14 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>切り出す部材がありません</p>
          <p style={{ margin: '6px 0 0' }}>
            {result.done.length > 0 && result.skipped.length === 0
              ? 'すべての部材が以前の版で木取り済みです（下の一覧で「外す」を押すと、木取りに戻ります）。'
              : '部材の画面で、枚数と材料を入れてください。'}
          </p>
        </div>
      ) : (
        <SavingHints job={job} />
      )}

      <StockShortageNotice shortages={shortages} />

      {result.stacks.rejected.length > 0 && (
        <div className="card kd-issues warn" role="note">
          <h4>重ねなかった組</h4>
          <ul>
            {result.stacks.rejected.map((p) => (
              <li key={p.key}>
                <b>{stackPairName(job, p.boardIds)}</b>
                ：重ねると材料が増えるので、重ねずに木取りしています
              </li>
            ))}
          </ul>
        </div>
      )}

      {!empty && (
        <div className="card kd-summary" style={{ marginTop: 14 }}>
          <div className="kd-total">
            <span className="kd-total-label">全体の歩留まり</span>
            <span className="kd-total-value num">{pct(summaries.totalYieldRate)}</span>
          </div>
          <ul className="kd-mats">
            {sections.map((sec) => (
              <MaterialRow
                key={sec.boardId}
                label={sec.label}
                summary={sec.summary}
                stack={sec.stack}
                mode={sec.mode}
                m={resultOf(sec.boardId)}
                auto={s.cutMode === 'auto'}
                target={sec.stack ?? sec.boardId}
                choice={sec.choice}
                usage={usage.find((u) => u.boardId === sec.boardId) ?? null}
                comparison={compare.find((c) => c.boardId === sec.boardId) ?? null}
                bySize={sec.stocked ? (sizeCounts.find((c) => c.boardId === sec.boardId)?.bySize ?? []) : null}
              />
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

      {result.done.length > 0 && (
        <div className="card kd-issues done">
          <h4>木取り済み（計算から除いています）</h4>
          <p className="band-note">以前の版で部材ごとに付けた木取り済みです。「外す」を押すと、木取りの計算に戻ります。</p>
          <ul className="kd-done-list">
            {result.done.map((d) => {
              const b = d.boardId === null ? null : boardOf(d.boardId)
              return (
                <li key={`${d.partId}-${d.boardId ?? ''}`} className="kd-done-row">
                  <span className="kd-done-name num">
                    <b>{d.name}</b>（{b ? boardLabel(b) : '材料が未設定'}）{d.quantity}枚
                  </span>
                  <button
                    type="button"
                    className="btn kd-done-btn"
                    aria-label={`${d.name} の木取り済みを外す`}
                    onClick={() => run((j) => clearLegacyCut(j, d.partId, d.boardId))}
                  >
                    外す
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {progress.length > 0 && (
        <div className="card kd-progress">
          <h4>部材ごとの進み具合</h4>
          <ul className="pp-list">
            {progress.map((p) => {
              const all = p.done >= p.total
              return (
                <li key={p.partId} className={`pp-row${all ? ' all' : ''}`}>
                  <span className="pp-name">
                    {p.name}
                    {all && <span className="pp-all">切り終わり</span>}
                  </span>
                  <span
                    className="pp-bar"
                    role="progressbar"
                    aria-label={`${p.name} の切り出し`}
                    aria-valuemin={0}
                    aria-valuemax={p.total}
                    aria-valuenow={p.done}
                  >
                    <span className="pp-fill" style={{ width: `${(p.done / p.total) * 100}%` }} />
                  </span>
                  <span className="pp-count num">
                    {p.done}/{p.total}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ふつうの1枚の無い材料（組の1枚だけの材料）は、1枚ごとの段を出さない */}
      {sections.map((sec) => (
        <section key={sec.boardId} aria-label={sec.label}>
          <h3 data-cl-key={`sec:${sec.boardId}`}>
            {sec.label}
            <span className="kd-h3-sub num">
              {sec.sheets.length > 0
                ? `${sheetCountText(sec.sheets)}${sec.mode ? `・${cutModeLabel(sec.mode)}` : ''}`
                : sec.finished.length > 0
                  ? 'すべて切り終わり'
                  : '切り出す板はありません'}
            </span>
          </h3>
          {sec.finished.length > 0 && (
            <button
              type="button"
              className="kd-finished-btn"
              aria-expanded={openFinished[sec.boardId] === true}
              onClick={() => setOpenFinished((o) => ({ ...o, [sec.boardId]: !o[sec.boardId] }))}
            >
              <span className="num">切り終わり {sec.finished.length}枚</span>
              <span className="kd-finished-hint">{openFinished[sec.boardId] ? '閉じる' : '開いて見る・チェックを外す'}</span>
            </button>
          )}
          {openFinished[sec.boardId] && sec.finished.length > 0 && (
            <div className="stack kd-finished">
              {sec.finished.map((e, i) => (
                <SheetCard
                  key={e.key}
                  entry={e}
                  no={e.name ? i + 1 : plainNo(sec.finished, e)}
                  count={plainCount(sec.finished)}
                  finished
                  label={sec.label}
                  size={isOffcut(e) ? null : sec.stocked || e.layout.sheet ? layoutSizeLabel(e.layout) : null}
                  rows={sheetPartChecklist(job, e.layout, e.checked)}
                  colorOf={colorOf}
                  onToggle={(row, key, el) => toggle(sec.boardId, e, row, key, el)}
                />
              ))}
            </div>
          )}
          {sec.sheets.length > 0 && (
            <div className="stack">
              {sec.sheets.map((e, i) => (
                <SheetCard
                  key={e.key}
                  entry={e}
                  no={e.name ? i + 1 : plainNo(sec.sheets, e)}
                  count={plainCount(sec.sheets)}
                  label={sec.label}
                  size={isOffcut(e) ? null : sec.stocked || e.layout.sheet ? layoutSizeLabel(e.layout) : null}
                  rows={sheetPartChecklist(job, e.layout, e.checked)}
                  colorOf={colorOf}
                  onToggle={(row, key, el) => toggle(sec.boardId, e, row, key, el)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </section>
  )
}

interface MaterialRowProps {
  label: string
  summary: MaterialSummary
  /** 重ね切りの組の行なら、組の2つの材料 */
  stack: [string, string] | null
  mode: 'vertical' | 'horizontal' | null
  /** 計算した結果（固定した1枚しか無い材料は null のことがある） */
  m: MaterialResult | null
  auto: boolean
  /** 操作する行（材料の id、組なら2つの材料の id） */
  target: string | [string, string]
  /** その行のサイズの設定（材料が仕事に無ければ null。サイズの選択を出さない） */
  choice: SheetChoice | null
  usage: StockUsage | null
  comparison: MaterialSizeComparison | null
  /** 手持ちで木取りする材料（組）なら、サイズ別の枚数（サイズの選択のかわりに出す） */
  bySize: SizeCount[] | null
}

function MaterialRow({ label, summary, stack, mode, m, auto, target, choice, usage, comparison, bySize }: MaterialRowProps) {
  const n = summary.sheetCount
  const off = summary.offcutCount
  return (
    <li className={stack ? 'kd-mat kd-mat-stack' : 'kd-mat'}>
      <div className="kd-mat-name">{label}</div>
      <div className="kd-mat-nums">
        <span>
          <span className="kd-k">必要な材料</span>
          <span className="kd-v num">
            {n}枚{off > 0 && <span className="kd-v-sub">（端材から {off}枚）</span>}
          </span>
        </span>
        <span>
          <span className="kd-k">歩留まり</span>
          <span className="kd-v num">{n + off > 0 ? pct(summary.yieldRate) : '―'}</span>
        </span>
      </div>
      {n + off > 0 && mode && (
        <div className="kd-mat-mode">
          切り方：<b>{cutModeLabel(mode)}</b>
          {auto && m && m.sheets.length > 0 && <span className="chip ok">おまかせで選択</span>}
        </div>
      )}
      {bySize && bySize.length > 0 && (
        <div className="kd-mat-mode num">
          手持ち：<b>{bySize.map((c) => `${c.label} ×${c.count}`).join('・')}</b>
        </div>
      )}
      {choice && (
        <SheetSizePicker
          target={target}
          choice={choice}
          label={label}
          compare={comparison}
          current={m}
          usage={usage}
        />
      )}
    </li>
  )
}

interface SheetCardProps {
  entry: SheetEntry
  /** 材料の中の通しの番号（固定した1枚 → 計算した1枚） */
  no: number
  count: number
  /** 切り終わった1枚（グレーで開く） */
  finished?: boolean
  label: string
  /** 手持ちの1枚の大きさ（「4×8」）。サイズを選んだ材料は null */
  size: string | null
  rows: SheetPartRow[]
  colorOf: (partId: string) => number
  onToggle: (row: SheetPartRow, key: string, el: HTMLElement) => void
}

function SheetCard({ entry, no, count, finished = false, label, size, rows, colorOf, onToggle }: SheetCardProps) {
  const { layout: sheet, grain, trim } = entry
  const drift = entry.view?.drift ?? []
  const landscape = sheet.orientation === 'landscape'
  // 図の上で木目の線が横に通るか（横長で長手方向、または縦長で妻手方向）
  const grainAcross = (grain === 'long') === landscape
  // 残りの材料（まだ切っていない部材の入っているもの）は、チェックのある1枚だけに出す
  const remaining =
    entry.view && entry.checked.length > 0 ? entry.view.progress.remaining.filter((q) => q.pieceIds.length > 0).map((q) => q.rect) : []
  // 押した行の位置を保つキー（1枚の id と部材。第2.7版）
  const rowKey = (r: SheetPartRow) =>
    entry.target.kind === 'frozen' ? `${entry.target.sheetId}:${r.partId}` : `${entry.key}:${r.partId}`
  return (
    <article className={finished ? 'card kd-sheet finished' : 'card kd-sheet'}>
      {drift.length > 0 && (
        <p className="kd-drift" role="note">
          部材が変わっています：{drift.map((d) => `${d.name}（${DRIFT_REASON[d.reason]}）`).join('・')}
          <span className="band-note">この1枚は固定したままです。作り直すときは、チェックをすべて外してください。</span>
        </p>
      )}
      <header className="kd-sheet-head">
        <span className="kd-sheet-no">
          {finished ? '切り終わり ' : ''}
          {entry.name ?? (
            <>
              {no}枚目<span className="kd-of"> / {count}枚</span>
            </>
          )}
          {size && <span className="kd-of num">（{size}）</span>}
        </span>
        <span className="kd-sheet-yield num">歩留まり {pct(sheet.yieldRate)}</span>
      </header>
      <p className="band-note num">
        材料 {fmt(sheet.boardWidth)}×{fmt(sheet.boardLength)}・部材 {sheet.placements.length}枚
      </p>
      <SheetDiagram sheet={sheet} no={no} name={entry.name} grain={grain} colorOf={colorOf} checked={entry.checked} remaining={remaining} />
      {remaining.length > 0 && (
        <p className="kd-remain num">
          残りの材料 {remaining.map((r) => `${fmt(r.w)}×${fmt(r.h)}`).join('・')}
        </p>
      )}
      <p className="dg-legend">
        {sheet.trims.length > 0 && (
          <span>
            <i className="dg-key trim" />
            端切り {fmt(trim)}mm（{landscape ? (sheet.usable.y > 0 ? '下・右' : '上・右') : '右'}）
          </span>
        )}
        {entry.checked.length > 0 && (
          <span>
            <i className="dg-key done" />
            済（切った部材）
          </span>
        )}
        {remaining.length > 0 && (
          <span>
            <i className="dg-key remain" />
            残りの材料（横×縦）
          </span>
        )}
        <span>
          <i className={`dg-key grain ${grainAcross ? 'across' : 'down'}`} />
          木目：{grain === 'long' ? '長手方向' : '妻手方向'}
        </span>
        <span>部材は右上から詰める・部材の寸法は木取り寸法</span>
      </p>
      <SheetChecklist label={`${label} の ${entry.name ?? `${no}枚目`}`} rows={rows} checked={entry.checked} rowKey={rowKey} onToggle={onToggle} />
    </article>
  )
}

// W・H・D の式の入力。<input> を使わず式を表示する枠にするので、押しても電話のキーボードは出ない。
// 枠を押すとボタンの並びが開き、カーソルが末尾に来る。部材の寸法・材料の厚み・逃げ・数字・演算子のボタンだけで式を作る。
// 材料の厚みは {t:材料のid}、逃げは {n:逃げのid} として式に入れ、画面では ラワン4・逃げ1 と見せる（「mm」は付けない）
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { nigeName } from '../../engine/defaults'
import { thicknessRefLabel } from '../../engine/flush'
import { formulaLabels } from '../../engine/formula/display'
import { formulaUnits } from '../../engine/formula/units'
import { AXES, type Axis, type DimensionError, type Job, type Part } from '../../engine/types'
import { fmt } from '../format'
import { clearAll, deleteBefore, insertAt, moveLeft, moveRight, type Edit, type PadKey } from '../formulaEdit'

/** 式の欄とボタンの並びが見えるように、いちばん近いスクロールする枠（部材の編集シート）を動かす。
 * 全部が収まるなら動かす量をいちばん少なく、収まらないなら式の欄を枠の上端に合わせる。
 * 下端は、枠の下の余白（iPhone のホームバーの分 safe-area を含む）と、Safari の見えている範囲（visualViewport）を考える */
function scrollIntoComfort(field: HTMLElement, pad: HTMLElement) {
  let box: HTMLElement | null = field.parentElement
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
  const scroller = box ?? document.scrollingElement
  if (!(scroller instanceof HTMLElement)) return
  const r = scroller === document.scrollingElement ? new DOMRect(0, 0, window.innerWidth, window.innerHeight) : scroller.getBoundingClientRect()
  const vv = window.visualViewport
  const viewTop = Math.max(r.top, vv ? vv.offsetTop : 0)
  const viewBottom = Math.min(r.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight)
  const margin = 8
  const bottomMargin = Math.max(margin, Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0)
  const top = field.getBoundingClientRect().top
  const bottom = pad.getBoundingClientRect().bottom
  // いまのスクロール位置からの差
  const needDown = bottom - (viewBottom - bottomMargin) // 正ならこれだけ下へ動かすとボタンの並びの下端が見える
  const maxDown = top - (viewTop + margin) // これより下へ動かすと式の欄の上端が隠れる
  let delta = 0
  if (bottom - top > viewBottom - bottomMargin - (viewTop + margin)) delta = maxDown
  else if (needDown > 0) delta = needDown
  else if (maxDown < 0) delta = maxDown
  if (Math.abs(delta) < 1) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  scroller.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
}

const AXIS_NAME: Record<Axis, string> = { W: '幅', H: '高さ', D: '奥行き' }

/** 数字・演算子のボタン（表示, 入れる文字）。× ÷ − は * / - として式に入れる */
const KEYS: [string, PadKey][] = [
  ['7', '7'], ['8', '8'], ['9', '9'], ['+', '+'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['×', '*'],
  ['0', '0'], ['.', '.'], ['(', '('], ['÷', '/'],
]

interface Props {
  axis: Axis
  value: string
  onChange: (v: string) => void
  /** 表示名（ラワン4・逃げ1 など）を作るための材料と設定 */
  job: Pick<Job, 'boards' | 'flushes' | 'settings'>
  /** 編集中の部材で選んでいる材料またはフラッシュの id。厚みのボタンはこの1つだけ出す（null なら出さない） */
  thicknessId: string | null
  /** 参照ボタンに出す部材（編集中の部材自身は除く） */
  parts: Part[]
  /** 参照ボタンに添える、部材ごとの仕上がり寸法 */
  finishedOf: (partId: string) => Record<Axis, number> | null
  /** この欄の仕上がり寸法（計算できなければ null） */
  finished: number | null
  /** この欄の式のエラー */
  errors: DimensionError[]
  /** ボタンの並びを開いているか */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 式の中で色つきの塊として見せる単位 */
const CHIP_CLASS: Partial<Record<string, string>> = {
  partRef: 'chip-ref',
  thickness: 'chip-thick',
  nige: 'chip-nige',
  bad: 'chip-bad',
}

export function FormulaInput({ axis, value, onChange, job, thicknessId, parts, finishedOf, finished, errors, open, onOpenChange }: Props) {
  const id = `expr-${axis}`
  const units = formulaUnits(value)
  const labels = formulaLabels(value, job)
  // 厚みのボタンは、この部材で選んでいる材料（またはフラッシュ）だけ（式にある別の材料の厚みは、表示と計算はそのまま）
  const thickLabel = thicknessId === null ? null : thicknessRefLabel(job, thicknessId)
  // カーソル＝単位の番号（0〜単位の数）
  const [cursorRaw, setCursor] = useState(units.length)
  const cursor = Math.min(cursorRaw, units.length)
  const fieldRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<HTMLDivElement>(null)

  // ボタンの並びを開いたら、式の欄とボタンが見やすい位置に来るようにスクロールする（キーボードは出ないので、それを待たない）
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      if (fieldRef.current && padRef.current) scrollIntoComfort(fieldRef.current, padRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const apply = (edit: (text: string, at: number) => Edit) => {
    const e = edit(value, cursor)
    setCursor(e.cursor)
    if (e.text !== value) onChange(e.text)
  }
  const put = (piece: string) => apply((t, at) => insertAt(t, at, piece))

  // ボタンを押しても枠から注目が外れないようにする（画面が跳ねないように）
  const keep = (e: PointerEvent) => e.preventDefault()

  const openAtEnd = () => {
    setCursor(units.length)
    onOpenChange(true)
  }

  const spoken = labels.length > 0 ? labels.join(' ') : '空'
  const errorText = errors.map((e) => e.message).join('。')

  return (
    <div className="field" ref={fieldRef}>
      <span className="label" aria-hidden="true">
        {axis}（{AXIS_NAME[axis]}）
        {finished !== null && <span className="expr-result num"> 仕上がり {fmt(finished)}</span>}
      </span>
      <button
        type="button"
        className={`expr-box${open ? ' active' : ''}${errors.length > 0 ? ' bad' : ''}`}
        aria-describedby={errors.length > 0 ? `${id}-err` : undefined}
        aria-expanded={open}
        aria-controls={`${id}-pad`}
        aria-label={`${axis} の式：${spoken}。押すとボタンで入力できます`}
        onClick={openAtEnd}
      >
        {units.length === 0 && !open && <span className="expr-placeholder">押して数値または式を入力</span>}
        {units.map((u, i) => {
          const gap = i > 0 && u.start > units[i - 1].end
          // 削除した材料・逃げは赤で見せる（直す場所が分かるように）
          const missing = (u.kind === 'thickness' || u.kind === 'nige') && labels[i].startsWith('（削除した')
          const chip = missing ? 'chip-bad' : CHIP_CLASS[u.kind]
          return (
            <span key={`${u.start}-${u.text}`} className="expr-unit-wrap">
              {open && cursor === i && <span className="caret" aria-hidden="true" />}
              <span className={`expr-unit num${gap ? ' gap' : ''}${chip ? ` chip ${chip}` : ''}`}>{labels[i]}</span>
            </span>
          )
        })}
        {open && cursor === units.length && <span className="caret" aria-hidden="true" />}
      </button>
      {open ? (
        // ボタンの並びを開いているあいだは、エラーの場所の高さを決めておく（エラーが出ても消えてもボタンの位置がずれない）
        <div className={`expr-status${errors.length > 0 ? ' msg err' : ''}`} id={`${id}-err`} role={errors.length > 0 ? 'alert' : undefined}>
          {errors.length > 0 ? (
            <span className="expr-status-text">{errorText}</span>
          ) : (
            <span className="expr-status-text ok num">
              {finished !== null ? `＝ 仕上がり ${fmt(finished)}` : units.length === 0 ? '数値か式を入れてください' : ''}
            </span>
          )}
        </div>
      ) : (
        errors.length > 0 && (
          <p className="msg err" id={`${id}-err`} role="alert">
            {errorText}
          </p>
        )
      )}

      {open && (
        <div className="pad" id={`${id}-pad`} ref={padRef}>
          {parts.length > 0 && (
            <div className="pad-refs" aria-label="部材の寸法">
              {parts.map((p) => {
                const f = finishedOf(p.id)
                return AXES.map((a) => (
                  <button
                    key={`${p.id}-${a}`}
                    type="button"
                    className="pad-ref"
                    onPointerDown={keep}
                    onClick={() => put(`${p.name}.${a}`)}
                  >
                    <span className="ref-name">
                      {p.name}.{a}
                    </span>
                    <span className="ref-val num">{f ? fmt(f[a]) : '―'}</span>
                  </button>
                ))
              })}
            </div>
          )}
          {thicknessId !== null && thickLabel !== null && (
            <div className="pad-group">
              <span className="pad-title">材料の厚み</span>
              <div className="pad-chips">
                <button
                  type="button"
                  className="pad-chip chip-thick"
                  onPointerDown={keep}
                  onClick={() => put(`{t:${thicknessId}}`)}
                >
                  {thickLabel}
                </button>
              </div>
            </div>
          )}
          {job.settings.nige.length > 0 && (
            <div className="pad-group">
              <span className="pad-title">調整寸法</span>
              <div className="pad-chips">
                {job.settings.nige.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="pad-chip chip-nige"
                    onPointerDown={keep}
                    onClick={() => put(`{n:${n.id}}`)}
                  >
                    {nigeName(n)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="pad-keys">
            {KEYS.map(([label, key]) => (
              <button key={label} type="button" className="pad-key num" onPointerDown={keep} onClick={() => put(key)}>
                {label}
              </button>
            ))}
            <button type="button" className="pad-key num" onPointerDown={keep} onClick={() => put(')')}>
              )
            </button>
            <button
              type="button"
              className="pad-key"
              aria-label="カーソルを左へ"
              onPointerDown={keep}
              onClick={() => setCursor(moveLeft(value, cursor))}
            >
              ◀
            </button>
            <button
              type="button"
              className="pad-key"
              aria-label="カーソルを右へ"
              onPointerDown={keep}
              onClick={() => setCursor(moveRight(value, cursor))}
            >
              ▶
            </button>
            <button type="button" className="pad-key" onPointerDown={keep} onClick={() => apply(deleteBefore)}>
              1字消す
            </button>
            <button type="button" className="pad-key span2" onPointerDown={keep} onClick={() => apply(clearAll)}>
              全部消す
            </button>
            <button type="button" className="pad-key done span2" onPointerDown={keep} onClick={() => onOpenChange(false)}>
              完了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

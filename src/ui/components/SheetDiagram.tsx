// 配置図（SVG）：板を engine の置き方（sheet.orientation）で置き、端切り（sheet.trims）、部材（名前・寸法）、端材（点線・寸法）、木目の線を描く。
// 縦長（portrait）は長辺が縦、横長（landscape、横切り優先）は長辺が横。
// 位置と大きさはすべて engine の結果（SheetLayout）をそのまま使い、viewBox を板の寸法（mm）にして画面幅に合わせる。
// engine は左下が原点（y は上が +）なので、描くときに上下を反転する
import { useId } from 'react'
import type { BoardGrain, Rect, SheetLayout } from '../../engine/types'
import { fmt } from '../format'

interface Props {
  sheet: SheetLayout
  grain: BoardGrain
  /** 部材ごとの色の番号（0〜5） */
  colorOf: (partId: string) => number
}

/** 部材の色の数（index.css の --pc0〜--pc5） */
const PIECE_COLORS = 6

interface Label {
  lines: string[]
  size: number
  rotate: boolean
}

/** 文字の幅の見積もり（1文字の幅 ÷ 文字の大きさ）。和文は全角、英数字・記号は細め（多めに見積もる） */
function textEm(text: string): number {
  let em = 0
  for (const ch of text) em += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.62
  return em
}

const LINE_HEIGHT = 1.25

/** 長方形の中に文字が収まる大きさを探す。横書き → 縦向き（90°回す）→ 1行だけ の順に試し、
 *  最小の大きさでも入らなければ出さない（null） */
function fitLabel(w: number, h: number, candidates: string[][], max: number, min: number): Label | null {
  for (const lines of candidates) {
    const em = Math.max(...lines.map(textEm))
    const tall = lines.length * LINE_HEIGHT
    const sizeFor = (bw: number, bh: number) => Math.min(max, (bw * 0.88) / em, (bh * 0.88) / tall)
    const flat = sizeFor(w, h)
    const turned = sizeFor(h, w)
    // 横書きで十分な大きさなら横書き。そうでなければ大きく書けるほう
    const rotate = flat < max && turned > flat
    const size = rotate ? turned : flat
    if (size >= min) return { lines, size, rotate }
  }
  return null
}

function flipY(r: Rect, length: number): Rect {
  return { x: r.x, y: length - r.y - r.h, w: r.w, h: r.h }
}

function LabelText({ r, label, className }: { r: Rect; label: Label; className: string }) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const lh = label.size * LINE_HEIGHT
  const top = -((label.lines.length - 1) * lh) / 2
  return (
    <text
      className={className}
      fontSize={label.size}
      textAnchor="middle"
      dominantBaseline="central"
      transform={`translate(${cx} ${cy})${label.rotate ? ' rotate(-90)' : ''}`}
    >
      {label.lines.map((t, i) => (
        <tspan key={i} x={0} y={top + i * lh} className={i === 0 ? 'l1' : 'l2'}>
          {t}
        </tspan>
      ))}
    </text>
  )
}

export function SheetDiagram({ sheet, grain, colorOf }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const landscape = sheet.orientation === 'landscape'
  // 図の横（W）と縦（L）。横長なら長辺が横
  const W = landscape ? sheet.boardLength : sheet.boardWidth
  const L = landscape ? sheet.boardWidth : sheet.boardLength
  // 文字の大きさ（mm）。板の短辺に対する割合で決める（暫定。横長の見た目は ui-dev が調整する）
  const maxFont = sheet.boardWidth * 0.042
  const minFont = sheet.boardWidth * 0.026
  const gap = sheet.boardWidth * 0.03 // 木目の線の間隔
  // 木目の線が図の縦に通るか：縦長で長辺方向、または横長で短辺方向
  const grainVertical = (grain === 'long') !== landscape
  const grainPath = grainVertical ? `M ${gap / 2} 0 V ${L}` : `M 0 ${gap / 2} H ${W}`

  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${W} ${L}`}
      role="img"
      aria-label={`${sheet.index}枚目の配置図：板 ${fmt(sheet.boardWidth)}×${fmt(sheet.boardLength)}、部材 ${sheet.placements.length}枚、端材 ${sheet.scraps.length}枚`}
    >
      <defs>
        <pattern
          id={`grain-${uid}`}
          patternUnits="userSpaceOnUse"
          width={grainVertical ? gap : W}
          height={grainVertical ? L : gap}
        >
          <path d={grainPath} className="dg-grain" />
        </pattern>
        {[...sheet.placements, ...sheet.scraps].map((p, i) => {
          const r = flipY(p, L)
          return (
            <clipPath key={i} id={`clip-${uid}-${i}`}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} />
            </clipPath>
          )
        })}
      </defs>

      {/* 板（部材・端材のすき間は刃で消える部分） */}
      <rect className="dg-board" x={0} y={0} width={W} height={L} />

      {sheet.scraps.map((s, i) => {
        const r = flipY(s, L)
        return <rect key={i} className="dg-scrap" x={r.x} y={r.y} width={r.w} height={r.h} />
      })}

      {sheet.placements.map((p) => {
        const r = flipY(p, L)
        return (
          <rect
            key={p.pieceId}
            className={`dg-piece pc${colorOf(p.partId) % PIECE_COLORS}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
          />
        )
      })}

      {/* 木目：板全体に、板の木目の方向の線 */}
      <rect x={0} y={0} width={W} height={L} fill={`url(#grain-${uid})`} pointerEvents="none" />

      {sheet.trims.map((t, i) => {
        const r = flipY(t, L)
        return <rect key={i} className="dg-trim" x={r.x} y={r.y} width={r.w} height={r.h} />
      })}
      <rect className="dg-outline" x={0} y={0} width={W} height={L} />

      {sheet.placements.map((p, i) => {
        const r = flipY(p, L)
        const label = fitLabel(r.w, r.h, [[p.name, p.sizeLabel], [p.name]], maxFont, minFont)
        return (
          label && (
            <g key={p.pieceId} clipPath={`url(#clip-${uid}-${i})`}>
              <LabelText r={r} label={label} className="dg-text" />
            </g>
          )
        )
      })}
      {sheet.scraps.map((s, i) => {
        const r = flipY(s, L)
        const size = `${fmt(s.w)}×${fmt(s.h)}`
        const label = fitLabel(r.w, r.h, [['端材', size], [size]], maxFont * 0.9, minFont)
        return (
          label && (
            <g key={i} clipPath={`url(#clip-${uid}-${sheet.placements.length + i})`}>
              <LabelText r={r} label={label} className="dg-text scrap" />
            </g>
          )
        )
      })}
    </svg>
  )
}

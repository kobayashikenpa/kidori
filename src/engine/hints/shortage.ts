// 手持ちが足りないときの解決策（第2.2版。architecture.md 14.8）。
// 手持ちで木取りする材料の行で、入らない片（noStock）がある行ごとに（重ね切りの組は手持ちを使わない。architecture.md 15.9）、
// 3×6・4×8 を何枚足せば入るか、切り代 → 端切りを小さくすれば今の手持ちで入るかを知らせる。仕事のデータは書き換えない
import { computeDimensions } from '../dimensions'
import { packJob } from '../packing'
import { expandPieces, orientationsFor, type PieceShape } from '../packing/pieces'
import { usesStock } from '../packing/stock'
import { round1 } from '../round'
import { BOARD_SIZES, type DimensionResult, type Job, type PackingResult, type StockSheet } from '../types'
import { smallerSteps } from './saving'

export type AddKind = 'saburoku' | 'shihachi'

export interface StockShortage {
  /** 材料の id（重ね切りの組は手持ちを使わないので出ない。architecture.md 15.9） */
  boardId: string
  /** 「シナランバー 18mm」 */
  label: string
  /** 入らない部材の名前（部材の並び） */
  missing: string[]
  /** 3×6、4×8 の順。count は足すと入る枚数。null ＝ 足しても入らない（またはそのサイズに入らない片がある） */
  add: { kind: AddKind; count: number | null }[]
  /** 今の手持ちのままで入る設定（一番大きい値）。無ければ null */
  change: { kind: 'allowance' | 'trim'; value: number } | null
  /** 「シナランバー 18mm が足りません（入らない部材：棚板）」 */
  message: string
}

const ADD_KINDS: AddKind[] = ['saburoku', 'shihachi']

/** その行（材料のふつうの結果、または組の結果。boardId は材料の id か stackKey）に、手持ちが足りない片があるか */
function short(r: PackingResult, boardId: string): boolean {
  return r.materials.some((m) => m.boardId === boardId && m.unplaced.some((u) => u.reason === 'noStock'))
}

interface Target {
  boardId: string
  missing: string[]
  /** 入らない片の数（足す枚数の上限） */
  count: number
  shapes: PieceShape[]
}

/** 入らない片：部材ごとに（木取りする片の数 − 置けた片の数） */
function targetOf(job: Job, dims: DimensionResult, base: PackingResult, boardId: string): Target {
  const m = base.materials.find((x) => x.boardId === boardId)!
  const partIds = new Set(m.unplaced.filter((u) => u.reason === 'noStock').map((u) => u.partId))
  const expected = new Map<string, { n: number; shape?: PieceShape }>()
  for (const g of expandPieces(job, dims).groups) {
    if ((g.stack?.key ?? g.board.id) !== boardId) continue
    for (const p of g.pieces) {
      if (!partIds.has(p.partId)) continue
      const e = expected.get(p.partId) ?? { n: 0, shape: p.shape }
      e.n++
      expected.set(p.partId, e)
    }
  }
  for (const r of base.materials) {
    if (r.boardId !== boardId) continue
    for (const s of r.sheets) {
      for (const p of s.placements) {
        const e = expected.get(p.partId)
        if (e) e.n--
      }
    }
  }
  let count = 0
  const shapes: PieceShape[] = []
  for (const e of expected.values()) {
    if (!e.shape) continue
    shapes.push(e.shape)
    count += Math.max(0, e.n)
  }
  const order = new Map(job.parts.map((p, i) => [p.id, i]))
  const missing = m.unplaced
    .filter((u) => u.reason === 'noStock')
    .sort((a, b) => (order.get(a.partId) ?? 0) - (order.get(b.partId) ?? 0))
    .map((u) => u.name)
  return { boardId, missing, count: Math.max(1, count), shapes }
}

/** 足りない材料の行すべてに、kind を n 枚の行を足した写し（id は重ならないもの） */
function withAdded(job: Job, ids: readonly string[], kind: AddKind, n: number): Job {
  const [width, length] = BOARD_SIZES[kind]
  const row: StockSheet = { id: `shortage-${kind}`, sizeKind: kind, width, length, grain: 'long', count: n }
  return {
    ...job,
    boards: job.boards.map((b) => (ids.includes(b.id) ? { ...b, stock: [...(b.stock ?? []), row] } : b)),
  }
}

/**
 * 手持ちが足りないときの解決策（仕様書 9「手持ちの材料」）。対象は stockOn の材料の行で、
 * その結果に noStock の片がある行（まとめの並び＝材料の保存の並び）。重ね切りの組の行は手持ちを使わないので対象にしない（15.9）。
 * 足りない行が無ければ packJob を追加で呼ばずに []（base を渡せば1回も呼ばない）。
 * - 足す枚数：3×6・4×8（木目 長手方向）それぞれ、足りない材料すべてに同じ n 枚の行を足して packJob し、
 *   その材料の noStock が無くなった一番小さい n。1, 2, 4, … と倍にして入る n を見つけてから、その手前との間を半分ずつ狭める
 *   （計算の回数を減らすため。上限は入らない片の数で、それで入らなければ null）。
 *   入らない片のうち1つでもそのサイズに入らない材料は試さずに null
 *   注意：ここでは足りない行すべてに同時に n 枚足して試すが、画面（StockShortageNotice）は押した行1つにだけ足す。
 *   材料の行どうしは手持ちを分け合わないので、行ごとに別々に木取りし、結果は変わらない
 * - 設定の変更：お知らせ（findSavingHints）と同じ試し方。切り代（設定の切り代を使う部材があるとき）を大きい値から、
 *   切り代で入らなかった材料だけ端切り。その材料の noStock が無くなる一番大きい値。組み合わせは試さない
 */
export function stockShortage(job: Job, dims: DimensionResult, base?: PackingResult): StockShortage[] {
  if (!job.boards.some((b) => usesStock(b))) return []
  const r0 = base ?? packJob(job, dims)
  // 手持ちの行だけが noStock を出す（サイズを選んだ行は tooLarge）
  const ids = r0.materials.filter((m) => !m.stack && short(r0, m.boardId)).map((m) => m.boardId)
  if (ids.length === 0) return []

  const { trim, cutMode } = job.settings
  const fitMode = cutMode === 'horizontal' ? 'horizontal' : 'vertical'
  const targets = ids.map((id) => targetOf(job, dims, r0, id))

  // 足す枚数
  const adds = new Map<string, Map<AddKind, number | null>>(ids.map((id) => [id, new Map()]))
  for (const kind of ADD_KINDS) {
    const [width, length] = BOARD_SIZES[kind]
    const sheet = { width, length, grain: 'long' as const }
    const pending = targets.filter((t) => {
      const fits = t.shapes.every((s) => orientationsFor(s, sheet, trim, fitMode).length > 0)
      if (!fits) adds.get(t.boardId)!.set(kind, null)
      return fits
    })
    // n 枚足した結果（同じ n は1回だけ計算する）
    const memo = new Map<number, PackingResult>()
    const trial = (n: number) => {
      let r = memo.get(n)
      if (!r) {
        r = packJob(withAdded(job, ids, kind, n), dims)
        memo.set(n, r)
      }
      return r
    }
    // 1, 2, 4, … と倍にして入る n を見つけ、その手前との間を半分ずつ狭めて一番小さい n を探す（上限は入らない片の数）
    for (const t of pending) {
      let lo = 0
      let hi: number | null = null
      for (let n = 1; ; n = Math.min(n * 2, t.count)) {
        if (!short(trial(n), t.boardId)) {
          hi = n
          break
        }
        lo = n
        if (n >= t.count) break
      }
      while (hi !== null && hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (short(trial(mid), t.boardId)) lo = mid
        else hi = mid
      }
      adds.get(t.boardId)!.set(kind, hi)
    }
  }

  // 設定を変えて今の手持ちで入るか（切り代 → 端切り）
  const changes = new Map<string, StockShortage['change']>()
  const tryKind = (kind: 'allowance' | 'trim', values: number[]) => {
    for (const value of values) {
      const left = ids.filter((id) => !changes.has(id))
      if (left.length === 0) return
      const trial: Job = { ...job, settings: { ...job.settings, [kind]: value } }
      const r = packJob(trial, kind === 'allowance' ? computeDimensions(trial) : dims)
      for (const id of left) if (!short(r, id)) changes.set(id, { kind, value })
    }
  }
  const usesAllowance = job.parts.some((p) => p.quantity > 0 && p.allowance === null && p.flushId !== undefined)
  if (usesAllowance) tryKind('allowance', smallerSteps(job.settings.allowance))
  tryKind('trim', smallerSteps(trim))

  return targets.map((t): StockShortage => {
    const board = job.boards.find((b) => b.id === t.boardId)!
    const label = `${board.material} ${round1(board.thickness)}mm`
    return {
      boardId: t.boardId,
      label,
      missing: t.missing,
      add: ADD_KINDS.map((kind) => ({ kind, count: adds.get(t.boardId)!.get(kind) ?? null })),
      change: changes.get(t.boardId) ?? null,
      message: `${label} が足りません（入らない部材：${t.missing.join('、')}）`,
    }
  })
}

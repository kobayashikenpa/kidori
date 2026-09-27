// 固定した1枚（第1.8版。architecture.md 11.3〜11.5）：画面に出ていた1枚をまるごと写して持つ。
// 写しから描き、写しから進み具合を計算するので、部材や設定が変わっても固定した1枚は動かない
import { stackKey, stackLabel } from '../packing/stack'
import { combineYield } from '../packing/yield'
import { round1 } from '../round'
import type { DimensionResult, FrozenSheet, Job, PackingResult, Part, PartDimensions, SheetLayout } from '../types'
import { sheetProgress, type SheetProgress } from './sheetProgress'

/** frozenDemand のキー */
export function demandKey(partId: string, boardId: string): string {
  return `${partId}|${boardId}`
}

/** 1枚の写し（深いコピー）。元の結果とつながりを持たない */
function copyLayout(layout: SheetLayout): SheetLayout {
  return JSON.parse(JSON.stringify(layout)) as SheetLayout
}

/**
 * 画面に出ている1枚を写して、固定した1枚を作る（チェックは空）。
 * 材料名・厚み・木目は job.boards から、刃厚・端切りは job.settings から写す。材料が無ければ例外。
 * 重ね切りの組の1枚（第2.0版）は boardId に1つ目の材料 a、stackWith に2つ目の材料 b を渡す（b の材料名・厚みも写す）
 */
export function freezeSheet(
  job: Job,
  boardId: string,
  mode: 'vertical' | 'horizontal',
  layout: SheetLayout,
  id: string,
  now: Date,
  stackWith?: string,
): FrozenSheet {
  const board = job.boards.find((b) => b.id === boardId)
  if (!board) throw new Error(`材料が見つかりません: ${boardId}`)
  const other = stackWith === undefined ? undefined : job.boards.find((b) => b.id === stackWith)
  if (stackWith !== undefined && !other) throw new Error(`材料が見つかりません: ${stackWith}`)
  const sheet: FrozenSheet = {
    id,
    boardId,
    material: board.material,
    thickness: board.thickness,
    grain: board.grain,
    mode,
    kerf: job.settings.kerf,
    trim: job.settings.trim,
    layout: copyLayout(layout),
    checked: [],
    frozenAt: now.toISOString(),
  }
  if (other) sheet.stackWith = { boardId: other.id, material: other.material, thickness: other.thickness }
  return sheet
}

/**
 * 固定した1枚（切り終わりを含む）の片の数。キーは `${partId}|${boardId}`（demandKey）。
 * 重ね切りの1枚（stackWith あり）は、片1つを boardId と stackWith.boardId の両方に 1 ずつ数える（第2.0版）
 */
export function frozenDemand(job: Pick<Job, 'frozenSheets'>): Map<string, number> {
  const out = new Map<string, number>()
  const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1)
  for (const s of job.frozenSheets) {
    for (const p of s.layout.placements) {
      add(demandKey(p.partId, s.boardId))
      if (s.stackWith) add(demandKey(p.partId, s.stackWith.boardId))
    }
  }
  return out
}

// ---------- 表示用のまとめ（architecture.md 11.5） ----------

export interface FrozenDrift {
  partId: string
  /** 今の部材名（部材が無ければ写しの名前） */
  name: string
  /** size：木取り寸法が違う（エラーで出ないときも）／count：固定した片の数 ＞ 今の枚数／removed：部材が無い・その材料から切らない */
  reason: 'size' | 'count' | 'removed'
}

export interface FrozenSheetView {
  sheet: FrozenSheet
  /**
   * 「ラワン 4mm」（材料があれば今の名前、無ければ写し）。
   * 重ね切りの1枚（stackWith あり）は「メラミン1＋ラワン4（重ね切り）」
   */
  label: string
  /** 材料がある（重ね切りの1枚は2つとも） */
  boardExists: boolean
  progress: SheetProgress
  /** 空なら変わっていない。写しの片の並びで、部材ごとに1つ */
  drift: FrozenDrift[]
  /** 切り終わり（completedAt がある） */
  complete: boolean
}

/** 部材を今その材料から何枚切るか（フラッシュは 表面材の枚数×部材の枚数）。その材料から切らなければ null */
function currentQuantity(job: Job, part: Part, boardId: string): number | null {
  if (part.flushId !== undefined) {
    const flush = job.flushes.find((f) => f.id === part.flushId)
    const face = flush?.faces.find((f) => f.boardId === boardId)
    return face ? face.count * part.quantity : null
  }
  return part.boardId === boardId ? part.quantity : null
}

/** 今の木取り寸法の表示（面の2軸の順）。寸法が出なければ null */
function currentSizeLabel(d: PartDimensions | undefined): string | null {
  if (!d || !d.cutSize || !d.faceAxes || d.errors.some((e) => e.kind !== 'thicknessMismatch')) return null
  const [a0, a1] = d.faceAxes
  return `${round1(d.cutSize[a0])}×${round1(d.cutSize[a1])}`
}

/** 固定した1枚ごとの表示用のまとめ（frozenSheets の並び） */
export function frozenSheetViews(job: Job, dims: DimensionResult): FrozenSheetView[] {
  const demand = frozenDemand(job)
  const partById = new Map(job.parts.map((p) => [p.id, p]))
  const dimById = new Map(dims.parts.map((d) => [d.partId, d]))
  return job.frozenSheets.map((sheet): FrozenSheetView => {
    const board = job.boards.find((b) => b.id === sheet.boardId)
    const other = sheet.stackWith ? job.boards.find((b) => b.id === sheet.stackWith?.boardId) : undefined
    /** 片を切った材料（重ね切りの1枚は2つ。どちらでも判定し、部材ごとに1つにまとめる） */
    const boardIds = sheet.stackWith ? [sheet.boardId, sheet.stackWith.boardId] : [sheet.boardId]
    const drift: FrozenDrift[] = []
    const seen = new Set<string>()
    for (const pl of sheet.layout.placements) {
      if (seen.has(pl.partId)) continue
      seen.add(pl.partId)
      const part = partById.get(pl.partId)
      const quantities = boardIds.map((b) => (part ? currentQuantity(job, part, b) : null))
      const name = part?.name ?? pl.name
      let reason: FrozenDrift['reason'] | null = null
      // 1つの部材に理由が重なったら removed → count → size の順で1つにする（枚数0 の行は寸法が出ないことがあるため count を先に）
      if (!part || quantities.some((q) => q === null)) reason = 'removed'
      else if (boardIds.some((b, i) => (demand.get(demandKey(pl.partId, b)) ?? 0) > quantities[i]!)) reason = 'count'
      else {
        const label = currentSizeLabel(dimById.get(part.id))
        const labels = sheet.layout.placements.filter((x) => x.partId === pl.partId).map((x) => x.sizeLabel)
        if (label === null || labels.some((l) => l !== label)) reason = 'size'
      }
      if (reason) drift.push({ partId: pl.partId, name, reason })
    }
    const stackWith = sheet.stackWith
    return {
      sheet,
      label: stackWith
        ? stackLabel(job, [sheet.boardId, stackWith.boardId], [sheet, stackWith])
        : `${board?.material ?? sheet.material} ${board?.thickness ?? sheet.thickness}mm`,
      boardExists: board !== undefined && (stackWith === undefined || other !== undefined),
      progress: sheetProgress(sheet.layout, sheet.kerf, sheet.checked),
      drift,
      complete: sheet.completedAt !== undefined,
    }
  })
}

export interface MaterialSummary {
  /** 材料の id。重ね切りの組の行（第2.0版）は stackKey(a, b) */
  boardId: string
  /** 重ね切りの組の行（第2.0版）なら、組の2つの材料 */
  stack?: { boardIds: [string, string] }
  /**
   * 画面に出す材料の枚数 ＝ 固定した1枚（切り終わりを除く）＋ 計算した1枚。
   * 材料の行は、その材料をふつうに木取りする分だけ（重ね切りの組の1枚は組の行だけに数える。第2.1版）
   */
  sheetCount: number
  /** 重ね切りの組の1枚の数。組の行は sheetCount と同じ、材料の行はいつも 0（第2.1版から材料の行に組の1枚を足さないため） */
  stackedCount: number
  /** 同じ1枚たちの歩留まり */
  yieldRate: number
  /** 切り終わった1枚の数（材料の行はその材料だけで切った1枚、組の行はその組の1枚） */
  completedCount: number
}

const areasOf = (s: SheetLayout) => ({ usedArea: s.usedArea, boardArea: s.boardWidth * s.boardLength })

/** 固定した1枚の組の id（重ね切りでなければ null） */
function sheetStackKey(sheet: FrozenSheet): string | null {
  return sheet.stackWith ? stackKey(sheet.boardId, sheet.stackWith.boardId) : null
}

/**
 * 木取り画面の「必要な材料」「歩留まり」「全体の歩留まり」（暫定。未決事項 31）。
 * 並びは材料の保存の並び。固定した1枚しか無い材料・切り終わりしか無い材料も入れる。
 * 削除した材料の固定した1枚は最後に（固定した順）。
 * 重ね切り（第2.0版。architecture.md 12.5）：組の行を a の行の直後に足す（固定した組の1枚しか無い組も）。
 * 第2.1版（13.3）：材料の行には組の1枚を数えない（ふつうの1枚・固定した1枚・切り終わりが無い材料は行を出さない）。
 * 全体の歩留まりは今までどおり、組の1枚を a・b で2回数える
 */
export function materialSummaries(
  job: Job,
  result: PackingResult,
  views: readonly FrozenSheetView[],
): { materials: MaterialSummary[]; totalYieldRate: number } {
  const ids = [...job.boards.map((b) => b.id)]
  for (const v of views) {
    if (!ids.includes(v.sheet.boardId)) ids.push(v.sheet.boardId)
    const b = v.sheet.stackWith?.boardId
    if (b !== undefined && !ids.includes(b)) ids.push(b)
  }

  // 組：計算した組の結果の並び → 固定した組の1枚しか無い組（固定した順）
  const stacks: { key: string; boardIds: [string, string]; active: SheetLayout[]; completed: number }[] = []
  const stackOf = (key: string, boardIds: [string, string]) => {
    let x = stacks.find((s) => s.key === key)
    if (!x) {
      x = { key, boardIds, active: [], completed: 0 }
      stacks.push(x)
    }
    return x
  }
  const computedStacks = result.materials.filter((m) => m.stack)
  for (const m of computedStacks) stackOf(m.boardId, m.stack!.boardIds)
  for (const v of views) {
    const key = sheetStackKey(v.sheet)
    if (key === null) continue
    const x = stackOf(key, [v.sheet.boardId, v.sheet.stackWith!.boardId])
    if (v.complete) x.completed++
    else x.active.push(v.sheet.layout)
  }
  for (const m of computedStacks) stackOf(m.boardId, m.stack!.boardIds).active.push(...m.sheets)

  const all: SheetLayout[] = []
  const materials: MaterialSummary[] = []
  for (const boardId of ids) {
    const computed = result.materials.find((m) => m.boardId === boardId && !m.stack)
    const mine = views.filter((v) => v.sheet.boardId === boardId && !v.sheet.stackWith)
    if (computed || mine.length > 0) {
      const sheets = [...mine.filter((v) => !v.complete).map((v) => v.sheet.layout), ...(computed?.sheets ?? [])]
      all.push(...sheets)
      materials.push({
        boardId,
        sheetCount: sheets.length,
        stackedCount: 0,
        yieldRate: combineYield(sheets.map(areasOf)).yieldRate,
        completedCount: mine.filter((v) => v.complete).length,
      })
    }
    for (const s of stacks) {
      if (s.boardIds[0] !== boardId) continue
      // 組の1枚は a・b の2種類の材料を1枚ずつ使うので、全体の歩留まりには2回数える
      all.push(...s.active, ...s.active)
      materials.push({
        boardId: s.key,
        stack: { boardIds: [s.boardIds[0], s.boardIds[1]] },
        sheetCount: s.active.length,
        stackedCount: s.active.length,
        yieldRate: combineYield(s.active.map(areasOf)).yieldRate,
        completedCount: s.completed,
      })
    }
  }
  return { materials, totalYieldRate: combineYield(all.map(areasOf)).yieldRate }
}

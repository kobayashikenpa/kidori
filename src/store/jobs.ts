// 仕事・板・部材の操作（純粋関数）。元のデータは書き換えず、新しい仕事を返す
import { defaultSheet, nigeName, nigeNameKey, type BoardSheet } from '../engine/defaults'
import { renamePart } from '../engine/formula/rename'
import { refsOf } from '../engine/formula/evaluate'
import { parse } from '../engine/formula/parse'
import {
  partsUsingBoardThicknesses,
  partsUsingNige,
  partsUsingNiges,
  remapBoardIds,
} from '../engine/formula/usages'
import { normalizePartName, validatePartName } from '../engine/formula/tokenize'
import { eq1, round1 } from '../engine/round'
import {
  AXES,
  BOARD_SIZES,
  type Board,
  type BoardSizeKind,
  type Job,
  type Nige,
  type Part,
  type PartChecks,
  type Settings,
} from '../engine/types'
import { defaultTemplate, type SettingsTemplate } from './template'

/** 操作の結果。失敗したときは画面にそのまま出せる日本語の理由 */
export type OpResult = { ok: true; job: Job } | { ok: false; message: string }

/** 仕事への操作。成功なら新しい仕事、失敗なら理由を返す */
export type JobOp = (job: Job) => OpResult

/** id を作る。crypto.randomUUID が無い環境（古いブラウザ・http の画面）でも動くようにする */
export function newId(prefix: string): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const ok = (job: Job): OpResult => ({ ok: true, job })
const fail = (message: string): OpResult => ({ ok: false, message })

// ---------- 仕事 ----------

/**
 * 新しい仕事：設定と材料はひな形（最後に使った設定）を写す。初期値のひな形なら 逃げ0.5・1、材料 メラミン1・ラワン2.5・4・5.5。
 * 設定は深いコピー（逃げの id もそのまま）。材料は並びのまま、id は新しく、サイズは 4×8。部材なし
 */
export function createJob(
  name: string,
  template: SettingsTemplate = defaultTemplate(),
  now: Date = new Date(),
  id: string = newId('job'),
): Job {
  const t = now.toISOString()
  const s = template.settings
  return {
    id,
    name: name.trim() || '名前のない仕事',
    settings: { ...s, nige: s.nige.map((n) => ({ ...n })) },
    boards: template.materials.map((m) => {
      const b: Board = { id: newId('board'), material: m.material, thickness: m.thickness, ...defaultSheet() }
      if (m.builtIn) b.builtIn = true
      return b
    }),
    parts: [],
    createdAt: t,
    updatedAt: t,
  }
}

/** 仕事の名前を変える。空の名前は断る */
export function renameJob(job: Job, name: string): OpResult {
  const t = name.trim()
  if (!t) return fail('仕事の名前を入れてください')
  return ok({ ...job, name: t })
}

/** コピーの名前（例：「本棚 W900 のコピー」）。すでにある名前と重なれば「のコピー 2」「のコピー 3」…にする */
export function copyName(name: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim()))
  const base = `${name.trim()} のコピー`
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`
    if (!taken.has(n)) return n
  }
}

/**
 * 仕事をコピーする（似た家具を作るとき用）。仕事・板・部材の id は新しくし、部材が使う板は新しい板の id につけ替える。
 * 式の部材の参照は名前なのでそのまま。材料の厚み {t:…} は新しい板の id につけ替える。逃げの id は設定ごと写すのでそのまま。
 * 元の仕事は書き換えない
 */
export function copyJob(
  job: Job,
  existingNames: readonly string[],
  now: Date = new Date(),
  id: string = newId('job'),
): Job {
  const t = now.toISOString()
  const boardIds = new Map<string, string>()
  const boards = job.boards.map((b) => {
    const nid = newId('board')
    boardIds.set(b.id, nid)
    return { ...b, id: nid }
  })
  const parts = job.parts.map((p) => ({
    ...p,
    id: newId('part'),
    boardId: p.boardId === null ? null : (boardIds.get(p.boardId) ?? null),
    expr: {
      W: remapBoardIds(p.expr.W, boardIds),
      H: remapBoardIds(p.expr.H, boardIds),
      D: remapBoardIds(p.expr.D, boardIds),
    },
    checks: { ...p.checks },
  }))
  return {
    id,
    name: copyName(job.name, existingNames),
    settings: { ...job.settings, nige: job.settings.nige.map((n) => ({ ...n })) },
    boards,
    parts,
    createdAt: t,
    updatedAt: t,
  }
}

/** 仕事を一覧から消す。開いていた仕事を消したときは、何も開いていない状態にする */
export function deleteJob(
  jobs: readonly Job[],
  currentJobId: string | null,
  jobId: string,
): { jobs: Job[]; currentJobId: string | null } {
  return {
    jobs: jobs.filter((j) => j.id !== jobId),
    currentJobId: currentJobId === jobId ? null : currentJobId,
  }
}

/** 設定の一部を変える。数値は 0 以上 */
export function updateSettings(job: Job, patch: Partial<Settings>): OpResult {
  for (const key of ['kerf', 'trim', 'allowance'] as const) {
    const v = patch[key]
    if (v !== undefined && !(Number.isFinite(v) && v >= 0)) return fail('0 以上の数を入れてください')
  }
  return ok({ ...job, settings: { ...job.settings, ...patch } })
}

// ---------- 板 ----------

/** 板の表示名（例：シナランバー 18mm） */
export function boardLabel(board: Pick<Board, 'material' | 'thickness'>): string {
  return `${board.material} ${board.thickness}mm`
}

/** 板のサイズの表示（例：サブロク 910×1820） */
export function boardSizeLabel(board: Pick<Board, 'sizeKind' | 'width' | 'length'>): string {
  const size = `${board.width}×${board.length}`
  if (board.sizeKind === 'saburoku') return `3×6 ${size}`
  if (board.sizeKind === 'shihachi') return `4×8 ${size}`
  return `自由入力 ${size}`
}

/** 新しい板の下書き（4×8・木目は長手方向。サイズは木取りの画面で選ぶ） */
export function newBoard(p: Partial<Board> = {}): Board {
  return {
    id: newId('board'),
    material: '',
    thickness: 18,
    ...defaultSheet(),
    ...p,
  }
}

/** サイズの種類に合わせて寸法・木目をそろえる。サブロク・シハチは寸法が決まり、木目は長辺方向 */
function normalizeBoard(board: Board): Board {
  const material = board.material.trim()
  const kind: BoardSizeKind = board.sizeKind
  if (kind === 'custom') {
    // 自由入力は短い方を短辺にする
    const width = Math.min(board.width, board.length)
    const length = Math.max(board.width, board.length)
    return { ...board, material, width, length }
  }
  const [width, length] = BOARD_SIZES[kind]
  return { ...board, material, width, length, grain: 'long' }
}

function sameMaterial(a: string, b: string): boolean {
  return a.trim().normalize('NFKC') === b.trim().normalize('NFKC')
}

function validateBoard(job: Job, board: Board): string | null {
  if (!board.material) return '材料を入れてください'
  if (!(Number.isFinite(board.thickness) && board.thickness > 0)) return '厚みは 0 より大きい数を入れてください'
  if (!(Number.isFinite(board.width) && board.width > 0 && Number.isFinite(board.length) && board.length > 0)) {
    return '材料の大きさは 0 より大きい数を入れてください'
  }
  const dup = job.boards.find(
    (b) => b.id !== board.id && sameMaterial(b.material, board.material) && eq1(b.thickness, board.thickness),
  )
  if (dup) return `「${boardLabel(dup)}」はすでにあります（材料と厚みが同じものは2つ作れません）`
  return null
}

/** 板を足す。材料名＋厚みが同じ板があれば断る */
export function addBoard(job: Job, board: Board): OpResult {
  const b = normalizeBoard(board)
  const err = validateBoard(job, b)
  if (err) return fail(err)
  return ok({ ...job, boards: [...job.boards, b] })
}

/** 板を変える。材料名＋厚みがほかの板と同じなら断る */
export function updateBoard(job: Job, boardId: string, patch: Partial<Omit<Board, 'id'>>): OpResult {
  const cur = job.boards.find((b) => b.id === boardId)
  if (!cur) return fail('材料が見つかりません')
  const b = normalizeBoard({ ...cur, ...patch, id: boardId })
  const err = validateBoard(job, b)
  if (err) return fail(err)
  return ok({ ...job, boards: job.boards.map((x) => (x.id === boardId ? b : x)) })
}

/** その板を使っている部材の名前（部材の並び順） */
export function partsUsingBoard(job: Job, boardId: string): string[] {
  return job.parts.filter((p) => p.boardId === boardId).map((p) => p.name)
}

/** 板をまとめて消す（1回の操作）。無い id は飛ばす。1つも無ければ断る。使っていた部材の板は未設定（null）になる */
export function removeBoards(job: Job, boardIds: readonly string[]): OpResult {
  const ids = new Set(boardIds.filter((id) => job.boards.some((b) => b.id === id)))
  if (ids.size === 0) return fail('材料が見つかりません')
  return ok({
    ...job,
    boards: job.boards.filter((b) => !ids.has(b.id)),
    parts: job.parts.map((p) => (p.boardId !== null && ids.has(p.boardId) ? { ...p, boardId: null } : p)),
  })
}

/** 板をまとめて消す前の確認用：その板のどれかから切る部材の名前（重ならない）と、式でそのどれかの厚みを使っている部材 */
export function boardsUsages(job: Job, boardIds: readonly string[]): { cutFrom: string[]; thickness: string[] } {
  const ids = new Set(boardIds)
  return {
    cutFrom: job.parts.filter((p) => p.boardId !== null && ids.has(p.boardId)).map((p) => p.name),
    thickness: partsUsingBoardThicknesses(job, boardIds),
  }
}

/** 材料のサイズを選ぶ（木取りの画面）。3×6・4×8 は寸法が決まり木目は長手方向。自由入力は短辺・長辺・木目。0 以下の寸法は断る */
export function setBoardSize(job: Job, boardId: string, size: BoardSheet): OpResult {
  return updateBoard(job, boardId, {
    sizeKind: size.sizeKind,
    width: size.width,
    length: size.length,
    grain: size.grain,
  })
}

// ---------- 逃げ ----------

/**
 * 調整寸法（逃げ）の検査。名前が空でなく、寸法が 0 より大きく、
 * ほかの調整寸法と名前も寸法（小数第1位で比較）も同じでないこと
 */
function validateNige(job: Job, name: string, value: number, selfId: string | null): string | null {
  if (!name.trim()) return '名前を入れてください'
  if (!(Number.isFinite(value) && round1(value) > 0)) return '寸法は 0 より大きい数を入れてください'
  const key = nigeNameKey(name)
  const dup = job.settings.nige.find((n) => n.id !== selfId && nigeNameKey(n.name) === key && eq1(n.value, value))
  if (dup) return `${nigeName(dup)} はすでにあります`
  return null
}

/** 調整寸法（逃げ）を足す。名前（前後の空白は外す）と寸法。名前と寸法の両方が同じものがあれば断る */
export function addNige(job: Job, name: string, value: number, id: string = newId('nige')): OpResult {
  const err = validateNige(job, name, value, null)
  if (err) return fail(err)
  const nige: Nige = { id, name: name.trim(), value: round1(value) }
  return ok({ ...job, settings: { ...job.settings, nige: [...job.settings.nige, nige] } })
}

/** 調整寸法（逃げ）の名前と寸法を変える。式は id で参照しているので、表示と値がついてくる。名前と寸法の両方が同じほかの項目があれば断る */
export function updateNige(job: Job, nigeId: string, name: string, value: number): OpResult {
  if (!job.settings.nige.some((n) => n.id === nigeId)) return fail('逃げが見つかりません')
  const err = validateNige(job, name, value, nigeId)
  if (err) return fail(err)
  const nige = job.settings.nige.map((n) => (n.id === nigeId ? { ...n, name: name.trim(), value: round1(value) } : n))
  return ok({ ...job, settings: { ...job.settings, nige } })
}

/** 逃げを使っている部材（「部材名（軸）」）。消す前の確認に使う */
export function nigeUsages(job: Job, nigeId: string): string[] {
  return partsUsingNige(job, nigeId)
}

/** 逃げをまとめて消す（1回の操作）。無い id は飛ばす。1つも無ければ断る */
export function removeNiges(job: Job, nigeIds: readonly string[]): OpResult {
  const ids = new Set(nigeIds)
  if (!job.settings.nige.some((n) => ids.has(n.id))) return fail('逃げが見つかりません')
  return ok({ ...job, settings: { ...job.settings, nige: job.settings.nige.filter((n) => !ids.has(n.id)) } })
}

/** 逃げをまとめて消す前の確認用：式でそのどれかを使っている部材（例：［棚板（W）］） */
export function nigesUsages(job: Job, nigeIds: readonly string[]): string[] {
  return partsUsingNiges(job, nigeIds)
}

// ---------- 部材 ----------

/** 新しい部材の下書き */
export function newPart(p: Partial<Part> = {}): Part {
  return {
    id: newId('part'),
    name: '',
    boardId: null,
    expr: { W: '', H: '', D: '' },
    thicknessAxis: null,
    quantity: 1,
    grain: 'any',
    memo: '',
    checks: { finished: false, cut: false },
    allowance: null,
    ...p,
  }
}

function validatePartFields(part: Part): string | null {
  if (!(Number.isInteger(part.quantity) && part.quantity >= 0)) return '枚数は 0 以上の整数を入れてください'
  if (part.allowance !== null && !(Number.isFinite(part.allowance) && part.allowance >= 0)) {
    return '切り代は 0 以上の数を入れてください（空欄なら仕事の初期値）'
  }
  return null
}

/** 部材を足す。使えない名前・同じ名前の部材があれば断る */
export function addPart(job: Job, part: Part): OpResult {
  const name = part.name.trim()
  const invalid = validatePartName(
    name,
    job.parts.map((p) => p.name),
  )
  if (invalid) return fail(invalid)
  const p = { ...part, name }
  const err = validatePartFields(p)
  if (err) return fail(err)
  return ok({ ...job, parts: [...job.parts, p] })
}

/**
 * 部材を変える。名前を変えたときは、ほかの部材の式の参照（旧名.W など）も新しい名前につけ替える。
 * 使えない名前・同じ名前の部材があれば断る
 */
export function updatePart(job: Job, partId: string, patch: Partial<Omit<Part, 'id'>>): OpResult {
  const cur = job.parts.find((p) => p.id === partId)
  if (!cur) return fail('部材が見つかりません')
  const next: Part = { ...cur, ...patch, id: partId, name: (patch.name ?? cur.name).trim() }
  const err = validatePartFields(next)
  if (err) return fail(err)
  // 先に中身を入れ替え、そのあと名前を変える（式の参照のつけ替えは新しい式にも効く）
  const replaced = job.parts.map((p) => (p.id === partId ? { ...next, name: cur.name } : p))
  if (next.name === cur.name) return ok({ ...job, parts: replaced })
  const renamed = renamePart(replaced, partId, next.name)
  if (!renamed.ok) return fail(renamed.message)
  return ok({ ...job, parts: renamed.parts })
}

/** 部材を消す */
export function removePart(job: Job, partId: string): OpResult {
  if (!job.parts.some((p) => p.id === partId)) return fail('部材が見つかりません')
  return ok({ ...job, parts: job.parts.filter((p) => p.id !== partId) })
}

/** その部材の寸法を式で参照している、ほかの部材の名前（消す前の確認に使う） */
export function partsReferencing(job: Job, partId: string): string[] {
  const target = job.parts.find((p) => p.id === partId)
  if (!target) return []
  const key = normalizePartName(target.name)
  return job.parts
    .filter((p) => p.id !== partId)
    .filter((p) =>
      AXES.some((axis) => {
        const r = parse(p.expr[axis])
        return r.ok && refsOf(r.ast).some((ref) => normalizePartName(ref.part) === key)
      }),
    )
    .map((p) => p.name)
}

/** 部材の加工のチェック（仕上がり 済・木取り 済）を変える。寸法は変えない */
export function setPartChecks(job: Job, partId: string, patch: Partial<PartChecks>): OpResult {
  if (!job.parts.some((p) => p.id === partId)) return fail('部材が見つかりません')
  return ok({
    ...job,
    parts: job.parts.map((p) => (p.id === partId ? { ...p, checks: { ...p.checks, ...patch } } : p)),
  })
}

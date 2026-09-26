// 仕事・板・部材の操作（純粋関数）。元のデータは書き換えず、新しい仕事を返す
import { defaultNige } from '../engine/defaults'
import { renamePart } from '../engine/formula/rename'
import { refsOf } from '../engine/formula/evaluate'
import { parse } from '../engine/formula/parse'
import { normalizePartName, validatePartName } from '../engine/formula/tokenize'
import { eq1 } from '../engine/round'
import {
  AXES,
  BOARD_SIZES,
  DEFAULT_SETTINGS,
  type Board,
  type BoardSizeKind,
  type Job,
  type Part,
  type Settings,
} from '../engine/types'

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

/** 新しい仕事：設定は初期値、板・部材なし */
export function createJob(name: string, now: Date = new Date(), id: string = newId('job')): Job {
  const t = now.toISOString()
  return {
    id,
    name: name.trim() || '名前のない仕事',
    settings: { ...DEFAULT_SETTINGS, nige: defaultNige() },
    boards: [],
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
 * 式は部材の名前で参照しているので、そのままで同じように計算できる。元の仕事は書き換えない
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
    expr: { ...p.expr },
    checks: { ...p.checks },
    clearance: { ...p.clearance },
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

/** 新しい板の下書き（サブロク・木目は長辺方向） */
export function newBoard(p: Partial<Board> = {}): Board {
  const [width, length] = BOARD_SIZES.saburoku
  return {
    id: newId('board'),
    material: '',
    thickness: 18,
    sizeKind: 'saburoku',
    width,
    length,
    grain: 'long',
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

/** 板を消す。使っていた部材の板は未設定（null）になる。確認は画面側で partsUsingBoard を使って行う */
export function removeBoard(job: Job, boardId: string): OpResult {
  if (!job.boards.some((b) => b.id === boardId)) return fail('材料が見つかりません')
  return ok({
    ...job,
    boards: job.boards.filter((b) => b.id !== boardId),
    parts: job.parts.map((p) => (p.boardId === boardId ? { ...p, boardId: null } : p)),
  })
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
    clearance: {},
    allowance: null,
    ...p,
  }
}

function validatePartFields(part: Part): string | null {
  if (!(Number.isInteger(part.quantity) && part.quantity >= 0)) return '枚数は 0 以上の整数を入れてください'
  for (const v of Object.values(part.clearance)) {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0)) return '逃げは 0 以上の数を入れてください'
  }
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

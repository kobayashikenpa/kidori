// 仕事・板・部材の操作（純粋関数）。元のデータは書き換えず、新しい仕事を返す
import { boardTokenLabel, defaultSheet, nigeName, nigeNameKey, type BoardSheet } from '../engine/defaults'
import { flushesUsingBoards, partsUsingFlushes } from '../engine/flush'
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
import { eq1 } from '../engine/round'
import {
  AXES,
  BOARD_SIZES,
  type Board,
  type BoardSizeKind,
  type Flush,
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
 * 設定は深いコピー（逃げの id もそのまま）。材料は並びのまま、id は新しく、サイズは 4×8。フラッシュは id を新しくし、表面材は新しい材料を指す。部材なし
 */
export function createJob(
  name: string,
  template: SettingsTemplate = defaultTemplate(),
  now: Date = new Date(),
  id: string = newId('job'),
): Job {
  const t = now.toISOString()
  const s = template.settings
  const boards = template.materials.map((m) => {
    const b: Board = { id: newId('board'), material: m.material, thickness: m.thickness, ...defaultSheet() }
    if (m.builtIn) b.builtIn = true
    return b
  })
  // フラッシュの表面材は、材料名＋厚みが同じ材料の id に直す（見つからない表面材は外す）
  const flushes: Flush[] = template.flushes.map((f) => ({
    id: newId('flush'),
    name: f.name,
    core: f.core,
    faces: f.faces.flatMap((x) => {
      const b = boards.find((y) => sameMaterial(y.material, x.material) && eq1(y.thickness, x.thickness))
      return b ? [{ boardId: b.id, count: x.count }] : []
    }),
  }))
  return {
    id,
    name: name.trim() || '名前のない仕事',
    settings: { ...s, nige: s.nige.map((n) => ({ ...n })) },
    boards,
    flushes,
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
 * 式の部材の参照は名前なのでそのまま。材料の厚み {t:…} は新しい板（フラッシュ）の id につけ替える。逃げの id は設定ごと写すのでそのまま。
 * フラッシュの id・表面材・部材の flushId・表面材ごとの完了もつけ替える。
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
  const flushIds = new Map<string, string>()
  const flushes = job.flushes.map((f) => {
    const nid = newId('flush')
    flushIds.set(f.id, nid)
    return { ...f, id: nid, faces: f.faces.map((x) => ({ boardId: boardIds.get(x.boardId) ?? x.boardId, count: x.count })) }
  })
  // 式の {t:…} は材料とフラッシュのどちらも指す
  const thicknessIds = new Map([...boardIds, ...flushIds])
  const parts = job.parts.map((p) => {
    const part: Part = {
      ...p,
      id: newId('part'),
      boardId: p.boardId === null ? null : (boardIds.get(p.boardId) ?? null),
      expr: {
        W: remapBoardIds(p.expr.W, thicknessIds),
        H: remapBoardIds(p.expr.H, thicknessIds),
        D: remapBoardIds(p.expr.D, thicknessIds),
      },
      checks: { ...p.checks },
    }
    if (p.flushId !== undefined) part.flushId = flushIds.get(p.flushId) ?? p.flushId
    const done = p.checks.cutByBoard
    if (done) {
      part.checks.cutByBoard = Object.fromEntries(Object.entries(done).map(([k, v]) => [boardIds.get(k) ?? k, v]))
    }
    return part
  })
  return {
    id,
    name: copyName(job.name, existingNames),
    settings: { ...job.settings, nige: job.settings.nige.map((n) => ({ ...n })) },
    boards,
    flushes,
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
  // 式の厚みボタン・材料の選択で、材料（ラワン4）とフラッシュの名前が同じだと見分けられない
  const key = boardTokenLabel(board).normalize('NFKC')
  const flush = job.flushes.find((f) => f.name.trim().normalize('NFKC') === key)
  if (flush) return `「${boardTokenLabel(board)}」はフラッシュと同じ名前です。材料名か厚みを変えてください`
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
    // フラッシュの表面材からも外す（第1.5版。フラッシュの厚みはそのぶん薄くなる）
    flushes: job.flushes.map((f) =>
      f.faces.some((x) => ids.has(x.boardId)) ? { ...f, faces: f.faces.filter((x) => !ids.has(x.boardId)) } : f,
    ),
    parts: job.parts.map((p) => (p.boardId !== null && ids.has(p.boardId) ? { ...p, boardId: null } : p)),
  })
}

/**
 * 板をまとめて消す前の確認用：その板のどれかから切る部材の名前（重ならない）、式でそのどれかの厚みを使っている部材、
 * 表面材にそのどれかを使っているフラッシュの名前（第1.5版）
 */
export function boardsUsages(
  job: Job,
  boardIds: readonly string[],
): { cutFrom: string[]; thickness: string[]; flushes: string[] } {
  const ids = new Set(boardIds)
  return {
    cutFrom: job.parts.filter((p) => p.boardId !== null && ids.has(p.boardId)).map((p) => p.name),
    thickness: partsUsingBoardThicknesses(job, boardIds),
    flushes: flushesUsingBoards(job, boardIds),
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
 * ほかの調整寸法と表示名（名前＋寸法）が重ならないこと。
 * 寸法は丸めずに比べる（逃げ0.25 と 逃げ0.3 は別）。浮動小数の誤差だけは同じとみなす（nigeName が誤差を消す）
 */
function validateNige(job: Job, name: string, value: number, selfId: string | null): string | null {
  if (!name.trim()) return '名前を入れてください'
  if (!(Number.isFinite(value) && Number(value.toFixed(6)) > 0)) return '寸法は 0 より大きい数を入れてください'
  // 名前と寸法が同じもの、表示名（名前＋寸法）が重なるもの（例：「逃げ1」5 と「逃げ」15 はどちらも 逃げ15）も断る。仕様書 4
  const label = nigeNameKey(nigeName({ name: name.trim(), value }))
  const same = job.settings.nige.find((n) => n.id !== selfId && nigeNameKey(nigeName(n)) === label)
  if (same) return `${nigeName(same)} はすでにあります`
  return null
}

/** 調整寸法（逃げ）を足す。名前（前後の空白は外す）と寸法（丸めずに持つ）。表示名（名前＋寸法）がほかと同じになるなら断る */
export function addNige(job: Job, name: string, value: number, id: string = newId('nige')): OpResult {
  const err = validateNige(job, name, value, null)
  if (err) return fail(err)
  const nige: Nige = { id, name: name.trim(), value }
  return ok({ ...job, settings: { ...job.settings, nige: [...job.settings.nige, nige] } })
}

/** 調整寸法（逃げ）の名前と寸法を変える。式は id で参照しているので、表示と値がついてくる。寸法は丸めずに持つ。表示名（名前＋寸法）がほかと同じになるなら断る */
export function updateNige(job: Job, nigeId: string, name: string, value: number): OpResult {
  if (!job.settings.nige.some((n) => n.id === nigeId)) return fail('調整寸法が見つかりません')
  const err = validateNige(job, name, value, nigeId)
  if (err) return fail(err)
  const nige = job.settings.nige.map((n) => (n.id === nigeId ? { ...n, name: name.trim(), value } : n))
  return ok({ ...job, settings: { ...job.settings, nige } })
}

/** 逃げを使っている部材（「部材名（軸）」）。消す前の確認に使う */
export function nigeUsages(job: Job, nigeId: string): string[] {
  return partsUsingNige(job, nigeId)
}

/** 逃げをまとめて消す（1回の操作）。無い id は飛ばす。1つも無ければ断る */
export function removeNiges(job: Job, nigeIds: readonly string[]): OpResult {
  const ids = new Set(nigeIds)
  if (!job.settings.nige.some((n) => ids.has(n.id))) return fail('調整寸法が見つかりません')
  return ok({ ...job, settings: { ...job.settings, nige: job.settings.nige.filter((n) => !ids.has(n.id)) } })
}

/** 逃げをまとめて消す前の確認用：式でそのどれかを使っている部材（例：［棚板（W）］） */
export function nigesUsages(job: Job, nigeIds: readonly string[]): string[] {
  return partsUsingNiges(job, nigeIds)
}

// ---------- フラッシュ（第1.5版） ----------

/** フラッシュの入力（id 以外） */
export type FlushDraft = Omit<Flush, 'id'>

/**
 * フラッシュの検査。名前が空でなく、ほかのフラッシュと重ならない（前後の空白・全角半角をそろえて比べる）、
 * 芯材が 0 より大きい、表面材が1つ以上で、どれも登録済みの材料・枚数は1以上の整数・同じ材料を重ねない
 */
function validateFlush(job: Job, f: FlushDraft, selfId: string | null): string | null {
  if (!f.name) return '名前を入れてください'
  const key = f.name.normalize('NFKC')
  const same = job.flushes.find((x) => x.id !== selfId && x.name.trim().normalize('NFKC') === key)
  if (same) return `「${same.name}」はすでにあります`
  // 式の厚みボタン・材料の選択で、材料（ラワン4）とフラッシュの名前が同じだと見分けられない
  const board = job.boards.find((b) => boardTokenLabel(b).normalize('NFKC') === key)
  if (board) return `「${f.name}」は材料（${boardLabel(board)}）と同じ名前です。別の名前にしてください`
  if (!(Number.isFinite(f.core) && f.core > 0)) return '芯材の厚みは 0 より大きい数を入れてください'
  if (f.faces.length === 0) return '表面材を1つ以上選んでください'
  const seen = new Set<string>()
  for (const face of f.faces) {
    const b = job.boards.find((x) => x.id === face.boardId)
    if (!b) return '表面材の材料が見つかりません'
    if (seen.has(b.id)) return `表面材の「${boardLabel(b)}」が重なっています（枚数でまとめてください）`
    seen.add(b.id)
    if (!(Number.isInteger(face.count) && face.count >= 1)) return '表面材の枚数は 1 以上の整数を入れてください'
  }
  return null
}

function cleanFlush(f: FlushDraft): FlushDraft {
  return { name: f.name.trim(), core: f.core, faces: f.faces.map((x) => ({ boardId: x.boardId, count: x.count })) }
}

/** フラッシュを足す（一覧の最後）。名前が重なる・値がおかしければ断る */
export function addFlush(job: Job, draft: FlushDraft, id: string = newId('flush')): OpResult {
  const f = cleanFlush(draft)
  const err = validateFlush(job, f, null)
  if (err) return fail(err)
  return ok({ ...job, flushes: [...job.flushes, { id, ...f }] })
}

/** フラッシュを変える。部材・式は id で参照しているので、厚みがついてくる */
export function updateFlush(job: Job, flushId: string, draft: FlushDraft): OpResult {
  if (!job.flushes.some((f) => f.id === flushId)) return fail('フラッシュが見つかりません')
  const f = cleanFlush(draft)
  const err = validateFlush(job, f, flushId)
  if (err) return fail(err)
  return ok({ ...job, flushes: job.flushes.map((x) => (x.id === flushId ? { id: flushId, ...f } : x)) })
}

/** 部材からフラッシュの選択と表面材ごとの完了を外す（材料は未設定になる） */
function withoutFlush(p: Part): Part {
  const { flushId: _flushId, ...rest } = p
  const { cutByBoard: _cutByBoard, ...checks } = p.checks
  return { ...rest, boardId: null, checks }
}

/** フラッシュをまとめて消す（1回の操作）。無い id は飛ばす。1つも無ければ断る。使っていた部材は材料が未設定になる */
export function removeFlushes(job: Job, flushIds: readonly string[]): OpResult {
  const ids = new Set(flushIds.filter((id) => job.flushes.some((f) => f.id === id)))
  if (ids.size === 0) return fail('フラッシュが見つかりません')
  return ok({
    ...job,
    flushes: job.flushes.filter((f) => !ids.has(f.id)),
    parts: job.parts.map((p) => (p.flushId !== undefined && ids.has(p.flushId) ? withoutFlush(p) : p)),
  })
}

/** フラッシュをまとめて消す前の確認用：材料の欄で選んでいる部材の名前と、式でその厚みを使っている部材（「部材名（軸）」） */
export function flushesUsages(job: Job, flushIds: readonly string[]): { parts: string[]; thickness: string[] } {
  return { parts: partsUsingFlushes(job, flushIds), thickness: partsUsingBoardThicknesses(job, flushIds) }
}

/** フラッシュの部材の、表面材ごとの木取りの完了を変える。フラッシュの部材でない・表面材でない材料は断る */
export function setFlushCutCheck(job: Job, partId: string, boardId: string, done: boolean): OpResult {
  const part = job.parts.find((p) => p.id === partId)
  if (!part) return fail('部材が見つかりません')
  const flush = job.flushes.find((f) => f.id === part.flushId)
  if (!flush || !flush.faces.some((x) => x.boardId === boardId)) return fail('フラッシュの表面材が見つかりません')
  const cutByBoard = { ...part.checks.cutByBoard }
  if (done) cutByBoard[boardId] = true
  else delete cutByBoard[boardId]
  return ok({ ...job, parts: job.parts.map((p) => (p.id === partId ? { ...p, checks: { ...p.checks, cutByBoard } } : p)) })
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

/**
 * 材料とフラッシュをそろえる：flushId があれば boardId は null・checks.cut は false。材料なら cutByBoard を消す。flushId が undefined ならキーごと消す
 * （材料に戻すときは updatePart に flushId: undefined を渡す）
 */
function normalizeMaterial(part: Part): Part {
  // フラッシュの部材は checks.cut を使わない（完了は表面材ごとの cutByBoard）。材料の部材は cutByBoard を持たない
  if (part.flushId !== undefined) return { ...part, boardId: null, checks: { ...part.checks, cut: false } }
  let p = part
  if (p.checks.cutByBoard !== undefined) {
    const { cutByBoard: _cutByBoard, ...checks } = p.checks
    p = { ...p, checks }
  }
  if (!('flushId' in p)) return p
  const { flushId: _flushId, ...rest } = p
  return rest
}

function validatePartFields(job: Job, part: Part): string | null {
  if (part.flushId !== undefined && !job.flushes.some((f) => f.id === part.flushId)) return 'フラッシュが見つかりません'

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
  const p = normalizeMaterial({ ...part, name })
  const err = validatePartFields(job, p)
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
  const next: Part = normalizeMaterial({ ...cur, ...patch, id: partId, name: (patch.name ?? cur.name).trim() })
  const err = validatePartFields(job, next)
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

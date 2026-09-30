// 仕事・板・部材の操作（純粋関数）。元のデータは書き換えず、新しい仕事を返す
import { builtInKey, isDefaultMaterialKey } from '../engine/boards'
import { boardTokenLabel, defaultBoards, defaultSettings, defaultSheet, nigeName, nigeNameKey, type BoardSheet } from '../engine/defaults'
import { findStackSheet } from '../engine/packing/stock'
import { autoGroupName, flushesUsingBoards, flushThickness, partsUsingFlushes } from '../engine/flush'
import { renamePart } from '../engine/formula/rename'
import { refsOf } from '../engine/formula/evaluate'
import { parse } from '../engine/formula/parse'
import {
  partsUsingBoardThicknesses,
  partsUsingNige,
  partsUsingNiges,
  remapRefIds,
} from '../engine/formula/usages'
import { normalizePartName, validatePartName } from '../engine/formula/tokenize'
import { freezeSheet } from '../engine/progress/frozen'
import { eq1 } from '../engine/round'
import {
  AXES,
  BOARD_SIZES,
  type Board,
  type BoardSizeKind,
  type Flush,
  type FrozenSheet,
  type GroupForm,
  type Job,
  type Nige,
  type Part,
  type PartChecks,
  type Settings,
  type SheetChoice,
  type SheetLayout,
  type StackSheet,
  type StockSheet,
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

/**
 * 新しい仕事：いつも初期値の設定から始める（第2.5.1版。仕様書 4「設定の引き継ぎ」。前の仕事の設定は引き継がない）。
 * 刃厚3・端切り5・切り代10・縦切り優先・逃げ0.5・逃げ1、材料は最初から入っている材料（DEFAULT_MATERIALS・4×8）、材料グループなし、部材なし
 */
export function createJob(name: string, now: Date = new Date(), id: string = newId('job')): Job {
  const t = now.toISOString()
  return {
    id,
    name: name.trim() || '名前のない仕事',
    settings: defaultSettings(),
    boards: defaultBoards(newId),
    flushes: [],
    parts: [],
    frozenSheets: [],
    stackSheets: [],
    // 重ね切り（第2.6版）：新しい仕事はオン（architecture.md 18.7）
    stacking: 'on',
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

/** rekeyJob に渡す id：仕事の id と、材料・フラッシュ・部材・逃げの新しい id を作る関数 */
export interface RekeyIds {
  job: string
  next: (prefix: 'board' | 'flush' | 'part' | 'nige') => string
}

/**
 * 仕事の id を全部新しくした写しを作る（第2.4版。architecture.md 16.3）。元の仕事は書き換えない（深いコピー）。
 * 材料・フラッシュ・部材・逃げの id を next で作り直し、表面材・部材の boardId／flushId・式の {t:}／{n:}・
 * cutByBoard のキー・stackSheets.boardIds をつけ替える。式の部材の参照は名前なのでそのまま。
 * 手持ちの行・固定した1枚の id は仕事の中だけの id なのでそのまま。名前・作成日・更新日もそのまま。
 * - frozen: false：固定した1枚は [] にする（コピー・共有の取り込み）
 * - frozen: true：固定した1枚の boardId・stackWith.boardId・片の partId／pieceId・checked もつけ替える（バックアップの取り込み）。
 *   表に無い id（削除された材料・部材）はそのまま残す
 */
export function rekeyJob(job: Job, ids: RekeyIds, opts: { frozen: boolean }): Job {
  const boardIds = new Map<string, string>()
  const boards = job.boards.map((b) => {
    const nid = ids.next('board')
    boardIds.set(b.id, nid)
    // 手持ち（第2.2版）も写す（行は別のオブジェクトにする）
    return b.stock ? { ...b, id: nid, stock: b.stock.map((s) => ({ ...s })) } : { ...b, id: nid }
  })
  const board = (id: string) => boardIds.get(id) ?? id
  const flushIds = new Map<string, string>()
  const flushes = job.flushes.map((f) => {
    const nid = ids.next('flush')
    flushIds.set(f.id, nid)
    return { ...f, id: nid, faces: f.faces.map((x) => ({ boardId: board(x.boardId), count: x.count })) }
  })
  const nigeIds = new Map<string, string>()
  const nige = job.settings.nige.map((n) => {
    const nid = ids.next('nige')
    nigeIds.set(n.id, nid)
    return { ...n, id: nid }
  })
  // 式の {t:…} は材料とフラッシュのどちらも指す
  const maps = { thickness: new Map([...boardIds, ...flushIds]), nige: nigeIds }
  const partIds = new Map<string, string>()
  const parts = job.parts.map((p) => {
    const nid = ids.next('part')
    partIds.set(p.id, nid)
    const part: Part = {
      ...p,
      id: nid,
      boardId: p.boardId === null ? null : (boardIds.get(p.boardId) ?? null),
      expr: {
        W: remapRefIds(p.expr.W, maps),
        H: remapRefIds(p.expr.H, maps),
        D: remapRefIds(p.expr.D, maps),
      },
      checks: { ...p.checks },
    }
    if (p.flushId !== undefined) part.flushId = flushIds.get(p.flushId) ?? p.flushId
    const done = p.checks.cutByBoard
    if (done) {
      part.checks.cutByBoard = Object.fromEntries(Object.entries(done).map(([k, v]) => [board(k), v]))
    }
    return part
  })
  /** 片の id（`${partId}#n`）の部材の部分をつけ替える */
  const piece = (pieceId: string) => {
    const i = pieceId.lastIndexOf('#')
    if (i < 0) return pieceId
    const to = partIds.get(pieceId.slice(0, i))
    return to === undefined ? pieceId : `${to}${pieceId.slice(i)}`
  }
  const frozenSheets: FrozenSheet[] = opts.frozen
    ? job.frozenSheets.map((f) => {
        const copy = JSON.parse(JSON.stringify(f)) as FrozenSheet
        copy.boardId = board(f.boardId)
        if (copy.stackWith) copy.stackWith.boardId = board(copy.stackWith.boardId)
        for (const pl of copy.layout.placements) {
          pl.partId = partIds.get(pl.partId) ?? pl.partId
          pl.pieceId = piece(pl.pieceId)
        }
        copy.checked = copy.checked.map(piece)
        return copy
      })
    : []
  return {
    ...job,
    id: ids.job,
    settings: { ...job.settings, nige },
    // 消した最初の材料（第2.5.1版）は材料名＋厚みで持つので、つけ替えずに写す
    ...(job.removedBuiltIns ? { removedBuiltIns: [...job.removedBuiltIns] } : {}),
    boards,
    flushes,
    parts,
    frozenSheets,
    // 組の設定（第2.3版）は新しい材料の id につけ替え、手持ちの行も写す
    stackSheets: job.stackSheets.map((s) => {
      const copy: StackSheet = { ...s, boardIds: [board(s.boardIds[0]), board(s.boardIds[1])] }
      if (s.stock) copy.stock = s.stock.map((x) => ({ ...x }))
      return copy
    }),
  }
}

/**
 * 仕事をコピーする（似た家具を作るとき用）。rekeyJob（frozen: false）で id を全部新しくし（逃げの id も新しくなる。第2.4版）、
 * 名前を「〇〇 のコピー」、作成日・更新日を now にする。固定した1枚（切った記録）は写さない（第1.8版。未決事項 32）。
 * 元の仕事は書き換えない
 */
export function copyJob(
  job: Job,
  existingNames: readonly string[],
  now: Date = new Date(),
  id: string = newId('job'),
): Job {
  const t = now.toISOString()
  return {
    ...rekeyJob(job, { job: id, next: newId }, { frozen: false }),
    name: copyName(job.name, existingNames),
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

/**
 * 重ね切り（2枚重ね）のオン・オフ（第2.6版。仕事ごと。architecture.md 18.7）。木取りの画面で切り替える。
 * 固定した重ねた板とその端材の行は、オフでも残る
 */
export function setStacking(job: Job, stacking: Job['stacking']): OpResult {
  if (stacking !== 'on' && stacking !== 'off') return fail('重ね切りの設定が正しくありません')
  if (job.stacking === stacking) return ok(job)
  return ok({ ...job, stacking })
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

/** 板の表示名（例：ラワン 18mm） */
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
  // 式の厚みボタン・材料の選択で、材料（ラワン4）と材料グループの名前が同じだと見分けられない
  const key = boardTokenLabel(board).normalize('NFKC')
  const flush = job.flushes.find((f) => f.name.trim().normalize('NFKC') === key)
  if (flush) return `「${boardTokenLabel(board)}」は材料グループと同じ名前です。材料名か厚みを変えてください`
  return null
}

/** 板を足す。材料名＋厚みが同じ板があれば断る */
export function addBoard(job: Job, board: Board): OpResult {
  const b = normalizeBoard(board)
  const err = validateBoard(job, b)
  if (err) return fail(err)
  return ok({ ...job, boards: [...job.boards, b] })
}

/**
 * 板を変える。材料名＋厚みがほかの板と同じなら断る。
 * 最初の材料と同じ材料名＋厚みの材料の名前・厚みを変えたら、前のキーを removedBuiltIns に覚える（第2.5.1版）。
 * 木取りしない（noCut。第2.5版）は true で付け、undefined（や false）で外す。付け外し・厚みの変更のあと、
 * 重ねて切れなくなった材料グループは重ね切りを外し（組の行は残す）、自動の名前の材料グループは名前をつけ直す
 */
export function updateBoard(job: Job, boardId: string, patch: Partial<Omit<Board, 'id'>>): OpResult {
  const cur = job.boards.find((b) => b.id === boardId)
  if (!cur) return fail('材料が見つかりません')
  const { noCut, ...merged } = { ...cur, ...patch, id: boardId }
  const b = normalizeBoard(noCut === true ? { ...merged, noCut: true } : merged)
  const err = validateBoard(job, b)
  if (err) return fail(err)
  const boards = job.boards.map((x) => (x.id === boardId ? b : x))
  // 最初の材料と同じ材料名＋厚みの材料の名前・厚みを変えたら、前のキーを覚える（第2.5.1版。読み込みで足し直さないため）
  const before = builtInKey(cur.material, cur.thickness)
  const removed = job.removedBuiltIns ?? []
  const remember = before !== builtInKey(b.material, b.thickness) && isDefaultMaterialKey(before) && !removed.includes(before)
  const next = remember ? { ...job, boards, removedBuiltIns: [...removed, before] } : { ...job, boards }
  return ok(refreshAutoNames(next))
}

/**
 * 自動の名前（autoName）の材料グループの名前をつけ直す（第2.5版。仕様書 4「中身を変えると名前もついてくる」）。
 * 名前＝autoGroupName(初めの形, 中身の合計の厚み, ほかの名前)。登録順に決め、今の名前が正しい形（フラッシュ25・フラッシュ25-2）で
 * ほかと重ならなければそのまま残す（ほかの材料グループの名前が勝手に -2 に変わらないように）。変わらなければ同じオブジェクト
 */
export function refreshAutoNames(job: Job): Job {
  if (!job.flushes.some((f) => f.autoName === true)) return job
  const key = (n: string) => n.trim().normalize('NFKC')
  const taken = new Set(job.flushes.filter((f) => f.autoName !== true).map((f) => key(f.name)))
  let changed = false
  const flushes = job.flushes.map((f) => {
    if (f.autoName !== true) return f
    const base = autoGroupName(f.form ?? 'flush', flushThickness(f, job.boards))
    const cur = key(f.name)
    const fits = (cur === base || (cur.startsWith(`${base}-`) && /^\d+$/.test(cur.slice(base.length + 1)))) && !taken.has(cur)
    const name = fits ? f.name : autoGroupName(f.form ?? 'flush', flushThickness(f, job.boards), [...taken])
    taken.add(key(name))
    if (name === f.name) return f
    changed = true
    return { ...f, name }
  })
  return changed ? { ...job, flushes } : job
}

/** その板を使っている部材の名前（部材の並び順） */
export function partsUsingBoard(job: Job, boardId: string): string[] {
  return job.parts.filter((p) => p.boardId === boardId).map((p) => p.name)
}

/**
 * 板をまとめて消す（1回の操作）。無い id は飛ばす。1つも無ければ断る。使っていた部材の板は未設定（null）になる。
 * 最初から入っている材料と材料名＋厚みが同じ材料を消したら removedBuiltIns に覚える（第2.5.1版。読み込みで足し直さないため）
 */
export function removeBoards(job: Job, boardIds: readonly string[]): OpResult {
  const ids = new Set(boardIds.filter((id) => job.boards.some((b) => b.id === id)))
  if (ids.size === 0) return fail('材料が見つかりません')
  const removed = [...(job.removedBuiltIns ?? [])]
  for (const b of job.boards) {
    const k = builtInKey(b.material, b.thickness)
    if (ids.has(b.id) && isDefaultMaterialKey(k) && !removed.includes(k)) removed.push(k)
  }
  return ok(refreshAutoNames({
    ...job,
    ...(removed.length > 0 ? { removedBuiltIns: removed } : {}),
    boards: job.boards.filter((b) => !ids.has(b.id)),
    // フラッシュの表面材からも外す（第1.5版。フラッシュの厚みはそのぶん薄くなる）。
    // 第2.6版：重ね切りは仕事ごと（Job.stacking）なので、材料グループの stack はそのまま
    flushes: job.flushes.map((f) => (f.faces.some((x) => ids.has(x.boardId)) ? { ...f, faces: f.faces.filter((x) => !ids.has(x.boardId)) } : f)),
    parts: job.parts.map((p) => (p.boardId !== null && ids.has(p.boardId) ? { ...p, boardId: null } : p)),
    // 消した材料の入る重ね切りの組の設定も消す（第2.3版）
    stackSheets: job.stackSheets.filter((s) => !s.boardIds.some((id) => ids.has(id))),
  }))
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

// ---------- まとめの行のサイズ・手持ち（第2.3版。architecture.md 15.6） ----------

/** 操作する行：材料の行は材料の id、重ね切りの組の行は組の2つの材料の id（並びは問わない） */
export type SizeTarget = string | readonly [string, string]

/** 手持ちの行の下書き（id 以外） */
export type StockDraft = Omit<StockSheet, 'id'>

const STOCK_COUNT_MESSAGE = '枚数は1以上の整数にしてください'
/** 重ね切りの組の行は 3×6／4×8 だけ（仕様書 4。自由入力・手持ちは使えない。architecture.md 15.9） */
export const STACK_SIZE_MESSAGE = '重ね切りの組は 3×6 か 4×8 を選んでください'
const SIZE_MESSAGE = '材料の大きさは 0 より大きい数を入れてください'

/** 手持ちの行をそろえる：3×6・4×8 は寸法と木目を決まった値に、自由入力は短辺≦長辺に並べ直す。おかしければ理由 */
function normalizeStock(s: StockSheet): StockSheet | string {
  if (!(Number.isInteger(s.count) && s.count >= 1)) return STOCK_COUNT_MESSAGE
  if (s.sizeKind === 'custom') {
    if (!(Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.length) && s.length > 0)) return SIZE_MESSAGE
    const grain = s.grain === 'short' ? 'short' : 'long'
    return { ...s, width: Math.min(s.width, s.length), length: Math.max(s.width, s.length), grain }
  }
  const [width, length] = BOARD_SIZES[s.sizeKind]
  return { ...s, width, length, grain: 'long' }
}

/** 行のサイズをそろえる（3×6・4×8 は寸法と木目が決まる。自由入力は短辺≦長辺）。0 以下の寸法なら理由 */
function normalizeSize(size: BoardSheet): BoardSheet | string {
  if (size.sizeKind === 'custom') {
    if (!(Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.length) && size.length > 0)) return SIZE_MESSAGE
    const grain = size.grain === 'short' ? 'short' : 'long'
    return { sizeKind: 'custom', width: Math.min(size.width, size.length), length: Math.max(size.width, size.length), grain }
  }
  const [width, length] = BOARD_SIZES[size.sizeKind]
  return { sizeKind: size.sizeKind, width, length, grain: 'long' }
}

/** 組の行（2つの id）か */
const isPair = (target: SizeTarget): target is readonly [string, string] => typeof target !== 'string'

/**
 * 行の設定を変える。change は今の設定から新しい設定（または断る理由）を返す。組の行が無ければ 4×8 の行を作ってから変える。
 * 組の行は手持ちを持たない（以前の版の手持ちが残っていても、変えた行には残さない。15.9）
 */
function updateRow(job: Job, target: SizeTarget, change: (cur: SheetChoice) => SheetChoice | string): OpResult {
  if (typeof target === 'string') {
    const cur = job.boards.find((b) => b.id === target)
    if (!cur) return fail('材料が見つかりません')
    const next = change(cur)
    if (typeof next === 'string') return fail(next)
    const { stockOn: _on, stock: _stock, ...rest } = cur
    return ok({ ...job, boards: job.boards.map((b) => (b.id === target ? withChoice(rest, next) : b)) })
  }
  const [i, j] = target.map((id) => job.boards.findIndex((b) => b.id === id))
  if (i < 0 || j < 0 || i === j) return fail('材料が見つかりません')
  const boardIds: [string, string] = i < j ? [target[0], target[1]] : [target[1], target[0]]
  const cur = findStackSheet(job, boardIds)
  const next = change(cur ?? { boardIds, ...defaultSheet() })
  if (typeof next === 'string') return fail(next)
  const { stockOn: _on, stock: _stock, ...size } = next
  const row = withChoice({ boardIds: cur?.boardIds ?? boardIds }, size)
  return ok({
    ...job,
    stackSheets: cur ? job.stackSheets.map((s) => (s === cur ? row : s)) : [...job.stackSheets, row],
  })
}

/** base に行の設定（サイズ・木目・手持ち）をかぶせる。手持ちの行が0なら stock を持たず、stockOn も外す */
function withChoice<T extends object>(base: T, c: SheetChoice): T & SheetChoice {
  const out = { ...base, sizeKind: c.sizeKind, width: c.width, length: c.length, grain: c.grain } as T & SheetChoice
  if (c.stock && c.stock.length > 0) {
    out.stock = c.stock
    if (c.stockOn) out.stockOn = true
  }
  return out
}

/**
 * 行（材料の行・組の行）のサイズを選ぶ（木取りの画面の 3×6／4×8）。3×6・4×8 は寸法が決まり木目は長手方向。
 * 材料の行には自由入力の大きさ（以前の版の自由入力）も渡せる（短辺・長辺・木目。0 以下の寸法は断る）。組の行は 3×6／4×8 だけ（15.9）。
 * 自由入力（手持ち）を外す（stockOn を外す。手持ちの行は残す）。その行だけを変える（組の相手・材料の行は変えない。第2.3版）
 */
export function setRowSize(job: Job, target: SizeTarget, size: BoardSheet): OpResult {
  if (isPair(target) && size.sizeKind === 'custom') return fail(STACK_SIZE_MESSAGE)
  const n = normalizeSize(size)
  if (typeof n === 'string') return updateRow(job, target, () => n)
  return updateRow(job, target, (cur) => ({ ...n, ...(cur.stock ? { stock: cur.stock } : {}) }))
}

/**
 * 材料の行の「自由入力（＝手持ち）」の切り替え。オンにするとき手持ちの行が無ければ、今の大きさ ×1 の行を1つ入れる。
 * オフは stockOn を外すだけ（行は残す。もう一度オンにすると同じ行）。組の行は手持ちを使わないので断る（15.9）
 */
export function setRowStockMode(job: Job, target: SizeTarget, on: boolean, id: string = newId('stock')): OpResult {
  if (isPair(target)) return fail(STACK_SIZE_MESSAGE)
  return updateRow(job, target, (cur) => {
    const { stockOn: _on, ...rest } = cur
    if (!on) return rest
    if (cur.stock && cur.stock.length > 0) return { ...rest, stockOn: true }
    const first = normalizeStock({ id, sizeKind: cur.sizeKind, width: cur.width, length: cur.length, grain: cur.grain, count: 1 })
    if (typeof first === 'string') return first
    return { ...rest, stockOn: true, stock: [first] }
  })
}

/** 材料の行に手持ちの行を足す（最後に）。枚数は1以上の整数。stockOn は変えない。組の行は断る（15.9） */
export function addRowStock(job: Job, target: SizeTarget, draft: StockDraft, id: string = newId('stock')): OpResult {
  if (isPair(target)) return fail(STACK_SIZE_MESSAGE)
  const row = normalizeStock({ ...draft, id })
  return updateRow(job, target, (cur) => (typeof row === 'string' ? row : { ...cur, stock: [...(cur.stock ?? []), row] }))
}

/** 材料の行の手持ちの行を変える（渡した項目だけ）。サイズの種類を変えたら 3×6・4×8 は寸法と木目を決まった値にする。組の行は断る（15.9） */
export function updateRowStock(job: Job, target: SizeTarget, stockId: string, patch: Partial<StockDraft>): OpResult {
  if (isPair(target)) return fail(STACK_SIZE_MESSAGE)
  return updateRow(job, target, (cur) => {
    const old = cur.stock?.find((s) => s.id === stockId)
    if (!old) return '手持ちの行が見つかりません'
    const row = normalizeStock({ ...old, ...patch, id: stockId })
    if (typeof row === 'string') return row
    return { ...cur, stock: cur.stock!.map((s) => (s.id === stockId ? row : s)) }
  })
}

/**
 * 材料の行の手持ちの行を消す（組の行は断る。15.9）。最後の1行を消すと stockOn も外れる（withChoice が、行が0の手持ちを持たないため）。
 * その行は自由入力をやめ、選んでいた 3×6／4×8（setRowStockMode でオンにする前のサイズ）で木取りする。
 * 行が0のまま自由入力に残すと、手持ちでも選んだサイズでもない中途半端な状態（usesStock が false）になるので、そうしない
 */
export function removeRowStock(job: Job, target: SizeTarget, stockId: string): OpResult {
  if (isPair(target)) return fail(STACK_SIZE_MESSAGE)
  return updateRow(job, target, (cur) => {
    if (!cur.stock?.some((s) => s.id === stockId)) return '手持ちの行が見つかりません'
    return { ...cur, stock: cur.stock.filter((s) => s.id !== stockId) }
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

// ---------- 材料グループ（第1.5版のフラッシュ。第2.5版で材料グループ） ----------

/** 材料グループの入力（id 以外） */
export type FlushDraft = Omit<Flush, 'id'>

const GROUP_FORMS: readonly GroupForm[] = ['flush', 'beta', 'empty']

/**
 * 材料グループの検査（第2.5版。architecture.md 17.8）。名前が空でなく、ほかの材料グループ・材料の表示名と重ならない
 * （前後の空白・全角半角をそろえて比べる）、中身が1つ以上で、どの行も登録済みの材料（空欄の行は断る）・
 * 同じ材料を重ねない・枚数は1以上の整数、重ね切りは木取りする中身が2種類で枚数が同じときだけ
 */
function validateFlush(job: Job, f: FlushDraft, selfId: string | null): string | null {
  if (!f.name) return '名前を入れてください'
  const key = f.name.normalize('NFKC')
  const same = job.flushes.find((x) => x.id !== selfId && x.name.trim().normalize('NFKC') === key)
  if (same) return `「${same.name}」はすでにあります`
  // 式の厚みボタン・材料の選択で、材料（ラワン4）と材料グループの名前が同じだと見分けられない
  const board = job.boards.find((b) => boardTokenLabel(b).normalize('NFKC') === key)
  if (board) return `「${f.name}」は材料（${boardLabel(board)}）と同じ名前です。別の名前にしてください`
  if (f.faces.length === 0) return '中身を1つ以上入れてください'
  const seen = new Set<string>()
  for (const face of f.faces) {
    if (face.boardId === '') return '中身の材料を選んでください'
    const b = job.boards.find((x) => x.id === face.boardId)
    if (!b) return '中身の材料が見つかりません'
    if (seen.has(b.id)) return `「${boardLabel(b)}」が重なっています（枚数でまとめてください）`
    seen.add(b.id)
    if (!(Number.isInteger(face.count) && face.count >= 1)) return '中身の枚数は 1 以上の整数を入れてください'
  }
  return null
}

/** 前後の空白を外す。重ね切り（第2.6版からは計算で見ないが、あれば残す）・自動の名前は true のときだけ、初めの形は3つのどれかのときだけ持つ */
function cleanFlush(f: FlushDraft): FlushDraft {
  const out: FlushDraft = { name: f.name.trim(), faces: f.faces.map((x) => ({ boardId: x.boardId, count: x.count })) }
  if (f.stack === true) out.stack = true
  if (f.form !== undefined && GROUP_FORMS.includes(f.form)) out.form = f.form
  if (f.autoName === true) out.autoName = true
  return out
}

/** 材料グループを足す（一覧の最後）。名前が重なる・値がおかしければ断る */
export function addFlush(job: Job, draft: FlushDraft, id: string = newId('flush')): OpResult {
  const f = cleanFlush(draft)
  const err = validateFlush(job, f, null)
  if (err) return fail(err)
  return ok({ ...job, flushes: [...job.flushes, { id, ...f }] })
}

/** 材料グループを変える。部材・式は id で参照しているので、厚みがついてくる。自動の名前はつけ直す */
export function updateFlush(job: Job, flushId: string, draft: FlushDraft): OpResult {
  if (!job.flushes.some((f) => f.id === flushId)) return fail('材料グループが見つかりません')
  const f = cleanFlush(draft)
  const err = validateFlush(job, f, flushId)
  if (err) return fail(err)
  return ok(refreshAutoNames({ ...job, flushes: job.flushes.map((x) => (x.id === flushId ? { id: flushId, ...f } : x)) }))
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
  if (ids.size === 0) return fail('材料グループが見つかりません')
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
  if (part.flushId !== undefined && !job.flushes.some((f) => f.id === part.flushId)) return '材料グループが見つかりません'

  if (!(Number.isInteger(part.quantity) && part.quantity >= 0)) return '枚数は 0 以上の整数を入れてください'
  if (part.allowance !== null && !(Number.isFinite(part.allowance) && part.allowance >= 0)) {
    return '切り代は 0 以上の数を入れてください（空欄なら材料グループの部材は初期値、ほかの部材は 0）'
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

// ---------- 切りながら進める木取り（第1.8版。architecture.md 11.4） ----------

/** チェックを付け外しする1枚：固定した1枚、または画面に出ている計算した1枚（layout は表示中の MaterialResult.sheets[i]） */
export type SheetTarget =
  | { kind: 'frozen'; sheetId: string }
  | {
      kind: 'computed'
      /** 材料。重ね切りの組の1枚は1つ目の材料（MaterialResult.stack.boardIds[0]） */
      boardId: string
      /** 重ね切りの組の1枚（第2.0版）なら2つ目の材料（MaterialResult.stack.boardIds[1]） */
      stackWith?: string
      mode: 'vertical' | 'horizontal'
      layout: SheetLayout
    }

/**
 * 1枚ごとのチェック（1片ずつ）を付け外しする。
 * - 計算した1枚にチェック：その1枚を写して固定し（checked は その片だけ）、固定した1枚の最後に足す。外す（done=false）は何もしない
 * - 固定した1枚：checked に足す／外す。すべての片にチェックが付いたら completedAt（切り終わり）、1つでも外したら消す。
 *   チェックがすべて外れたら、その1枚を消す（固定を外す。片は計算に戻る）
 * - 写しに無い pieceId・無い1枚・無い材料は断る
 */
export function setPieceCheck(
  job: Job,
  target: SheetTarget,
  pieceId: string,
  done: boolean,
  now: Date = new Date(),
  id: string = newId('sheet'),
): OpResult {
  if (target.kind === 'computed') {
    const { boardId, stackWith, mode, layout } = target
    if (!layout.placements.some((p) => p.pieceId === pieceId)) return fail('部材が見つかりません')
    if (!job.boards.some((b) => b.id === boardId)) return fail('材料が見つかりません')
    if (stackWith !== undefined && (stackWith === boardId || !job.boards.some((b) => b.id === stackWith))) {
      return fail('材料が見つかりません')
    }
    if (!done) return ok(job)
    const sheet = freezeSheet(job, boardId, mode, layout, id, now, stackWith)
    sheet.checked = [pieceId]
    if (sheet.layout.placements.length === 1) sheet.completedAt = now.toISOString()
    return ok({ ...job, frozenSheets: [...job.frozenSheets, sheet] })
  }

  const sheet = job.frozenSheets.find((f) => f.id === target.sheetId)
  if (!sheet) return fail('固定した1枚が見つかりません')
  if (!sheet.layout.placements.some((p) => p.pieceId === pieceId)) return fail('部材が見つかりません')
  const has = sheet.checked.includes(pieceId)
  if (done === has) return ok(job)
  const checked = done ? [...sheet.checked, pieceId] : sheet.checked.filter((x) => x !== pieceId)
  if (checked.length === 0) return ok({ ...job, frozenSheets: job.frozenSheets.filter((f) => f.id !== sheet.id) })
  const { completedAt: _completedAt, ...rest } = sheet
  const all = sheet.layout.placements.every((p) => checked.includes(p.pieceId))
  const next = all ? { ...rest, checked, completedAt: sheet.completedAt ?? now.toISOString() } : { ...rest, checked }
  return ok({ ...job, frozenSheets: job.frozenSheets.map((f) => (f.id === sheet.id ? next : f)) })
}

/**
 * 以前の版で付けた「木取り済み」（部材ごと）を外して、計算に戻す（第1.8版。architecture.md 11.9）。
 * ふつうの部材は checks.cut = false、フラッシュの部材は checks.cutByBoard[boardId] を消す（boardId は PackingResult.done の boardId）
 */
export function clearLegacyCut(job: Job, partId: string, boardId: string | null): OpResult {
  const part = job.parts.find((p) => p.id === partId)
  if (!part) return fail('部材が見つかりません')
  let checks: PartChecks
  if (part.flushId !== undefined && boardId !== null) {
    const cutByBoard = { ...part.checks.cutByBoard }
    delete cutByBoard[boardId]
    checks = { ...part.checks, cutByBoard }
  } else {
    checks = { ...part.checks, cut: false }
  }
  return ok({ ...job, parts: job.parts.map((p) => (p.id === partId ? { ...p, checks } : p)) })
}

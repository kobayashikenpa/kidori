// 見本（本棚 W900・フラッシュ25 と ラワン4 だけで作る）を、初期値の設定から作る（仕様書 4「設定の引き継ぎ（第2.5.1版）」、architecture.md 8.4）
import { NIGE_DEFAULT_NAME } from '../engine/defaults'
import { eq1 } from '../engine/round'
import { canStack, cutFaces } from '../engine/packing/stack'
import { BOARD_SIZES, type Board, type Flush, type Job, type Part, type StackSheet } from '../engine/types'
import { createJob, newId } from './jobs'

/** 見本の仕事の名前 */
export const SAMPLE_NAME = '本棚 W900'

/** 見本の材料グループの名前（芯材15（木取りしない）×1・メラミン1×2・ラワン4×2） */
export const SAMPLE_FLUSH_NAME = 'フラッシュ25'

const key = (s: string) => s.trim().normalize('NFKC')

function part(p: Partial<Part> & Pick<Part, 'name' | 'expr'>): Part {
  return {
    id: newId('part'),
    boardId: null,
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
 * 見本を作る。追加するたびに新しい仕事（id は新しく）。
 * - いつも初期値の設定から（createJob。第2.5.1版：最後に使った設定は引き継がない）
 * - 見本で使うものを足す：材料 芯材15（木取りしない）、フラッシュ25（芯材15×1・メラミン1×2・ラワン4×2。重ね切りオン＝第2.1版、
 *   form: flush・自動の名前＝第2.5版）。メラミン1・ラワン4・逃げ1 は初期値にあるものを使う（念のため、無ければ足す）
 * - 見本で使う材料は 3×6（未決事項 24）。フラッシュ25 の重ね切りの組の設定も 3×6（第2.3版）
 * - 側板・天地板・棚板はフラッシュ25、背板はラワン4（第1.7版。ラワン・シナベニヤは使わない＝仕様書 4 の文言。以前の見本のランバー 18mm・ベニヤ 4mm の板を使わない意味）。
 *   芯材15 は木取りしない材料なので、木取りの画面には出ない（第2.5版）。厚みは式の厚み（{t:…}）で書く
 */
export function sampleJob(now: Date = new Date()): Job {
  const job = createJob(SAMPLE_NAME, now)
  const [width, length] = BOARD_SIZES.saburoku
  const sheet = { sizeKind: 'saburoku', width, length, grain: 'long' } as const

  const boards: Board[] = [...job.boards]
  /** 材料名＋厚みの材料を使う（無ければ最後に足す）。見本で使うので 3×6 にする */
  const boardFor = (material: string, thickness: number, extra: Partial<Board> = {}): string => {
    const i = boards.findIndex((b) => key(b.material) === key(material) && eq1(b.thickness, thickness))
    if (i >= 0) {
      boards[i] = { ...boards[i], ...sheet, ...extra }
      return boards[i].id
    }
    const id = newId('board')
    boards.push({ id, material, thickness, ...sheet, ...extra })
    return id
  }

  // 芯材15：木取りしない材料（第2.5版）
  const core = boardFor('芯材', 15, { noCut: true })
  const flush: Flush = {
    id: newId('flush'),
    name: SAMPLE_FLUSH_NAME,
    faces: [
      { boardId: core, count: 1 },
      { boardId: boardFor('メラミン', 1), count: 2 },
      { boardId: boardFor('ラワン', 4), count: 2 },
    ],
    // 重ね切りは初期オン（第2.1版。仕様書 4）
    stack: true,
    form: 'flush',
    autoName: true,
  }
  const flushes: Flush[] = [...job.flushes, flush]
  const lauan4 = boardFor('ラワン', 4)

  // 逃げ1：あればその id、無ければ足す
  let nige = job.settings.nige
  let nigeId = nige.find((n) => key(n.name) === NIGE_DEFAULT_NAME && eq1(n.value, 1))?.id
  if (nigeId === undefined) {
    nigeId = newId('nige')
    nige = [...nige, { id: nigeId, name: NIGE_DEFAULT_NAME, value: 1 }]
  }

  const t = `{t:${flush.id}}`
  const parts: Part[] = [
    part({ name: '全体', expr: { W: '900', H: '1800', D: '400' }, quantity: 0 }),
    part({ name: '側板', flushId: flush.id, expr: { W: t, H: '全体.H', D: '全体.D' }, quantity: 2, grain: 'H' }),
    part({ name: '天地板', flushId: flush.id, expr: { W: '全体.W - 側板.W * 2', H: t, D: '全体.D' }, quantity: 2, grain: 'W' }),
    part({
      name: '棚板',
      flushId: flush.id,
      expr: { W: `天地板.W - {n:${nigeId}}`, H: t, D: '全体.D - 20' },
      quantity: 4,
      grain: 'W',
    }),
    part({
      name: '背板',
      boardId: lauan4,
      expr: { W: '全体.W', H: '全体.H', D: `{t:${lauan4}}` },
      quantity: 1,
      grain: 'H',
      allowance: 0,
    }),
  ]
  // 重ね切りの組（第2.3版）の設定も 3×6（見本の期待値＝組 3×6 で5枚を変えないため。未決事項 24 と同じ考え）。
  // 組の a・b は材料の保存の並び
  const stackSheets: StackSheet[] = []
  if (canStack(flush, boards)) {
    const ids = cutFaces(flush, boards).map((f) => f.boardId)
    const order = (id: string) => boards.findIndex((b) => b.id === id)
    const pair: [string, string] = order(ids[0]) < order(ids[1]) ? [ids[0], ids[1]] : [ids[1], ids[0]]
    stackSheets.push({ boardIds: pair, ...sheet })
  }
  return { ...job, settings: { ...job.settings, nige }, boards, flushes, parts, stackSheets }
}

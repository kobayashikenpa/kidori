// 見本（本棚 W900）を、最後に使った設定（ひな形）から作る（architecture.md 8.4）
import { BOARD_SIZES, type Board, type Job } from '../engine/types'
import { bookshelfJob } from '../engine/fixtures/bookshelf'
import { eq1 } from '../engine/round'
import { NIGE_DEFAULT_NAME } from '../engine/defaults'
import { createJob, newId } from './jobs'
import type { SettingsTemplate } from './template'

/** 見本の仕事の id（仕事の画面で「見本があるか」を見るのに使う） */
export const SAMPLE_JOB_ID = bookshelfJob().id

/** 見本の式で使っている逃げ1 の id */
const SAMPLE_NIGE_ID = 'nige-1'

const sameName = (a: string, b: string) => a.trim().normalize('NFKC') === b.trim().normalize('NFKC')

/**
 * ひな形から見本を作る。
 * - 設定の数値（刃厚・端切り・切り代・切り方）と材料はひな形のまま
 * - 見本の材料（シナランバー 18・シナベニヤ 4）は、同じ材料名＋厚みがあればそれを使い、無ければ最後に足す。どちらも 3×6 にする
 * - 見本の棚板が使う 逃げ1 は、名前「逃げ」寸法 1 の調整寸法があればそれを使い、無ければ足す
 */
export function sampleFromTemplate(template: SettingsTemplate, now: Date = new Date()): Job {
  const base = bookshelfJob()
  const job = createJob(base.name, template, now, SAMPLE_JOB_ID)
  const [width, length] = BOARD_SIZES.saburoku

  // 材料：見本の材料の id → この仕事の材料の id
  const boards: Board[] = [...job.boards]
  const boardIds = new Map<string, string>()
  for (const sb of base.boards) {
    const i = boards.findIndex((b) => sameName(b.material, sb.material) && eq1(b.thickness, sb.thickness))
    if (i >= 0) {
      boards[i] = { ...boards[i], sizeKind: 'saburoku', width, length, grain: 'long' }
      boardIds.set(sb.id, boards[i].id)
    } else {
      const id = newId('board')
      boards.push({ id, material: sb.material, thickness: sb.thickness, sizeKind: 'saburoku', width, length, grain: 'long' })
      boardIds.set(sb.id, id)
    }
  }

  // 逃げ1：あればその id、無ければ足す
  let nige = job.settings.nige
  let nigeId = nige.find((n) => n.name === NIGE_DEFAULT_NAME && eq1(n.value, 1))?.id
  if (nigeId === undefined) {
    nigeId = nige.some((n) => n.id === SAMPLE_NIGE_ID) ? newId('nige') : SAMPLE_NIGE_ID
    nige = [...nige, { id: nigeId, name: NIGE_DEFAULT_NAME, value: 1 }]
  }
  const fixNige = (e: string) => e.split(`{n:${SAMPLE_NIGE_ID}}`).join(`{n:${nigeId}}`)

  const parts = base.parts.map((p) => ({
    ...p,
    boardId: p.boardId === null ? null : (boardIds.get(p.boardId) ?? null),
    expr: { W: fixNige(p.expr.W), H: fixNige(p.expr.H), D: fixNige(p.expr.D) },
    checks: { ...p.checks },
  }))
  return { ...job, settings: { ...job.settings, nige }, boards, parts }
}

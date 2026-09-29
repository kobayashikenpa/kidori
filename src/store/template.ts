// 最後に使った設定（ひな形）。新しい仕事・見本はこれを写して作る（仕様書 4「設定の引き継ぎ」、architecture.md 8.3）
import { isBuiltInBoard } from '../engine/boards'
import { defaultSettings } from '../engine/defaults'
import { migrateFlushCores, type SpecGroup, type SpecMaterial } from '../engine/migrate/flushCore'
import type { Job, Settings } from '../engine/types'

/**
 * ひな形の材料：材料名と厚み・印だけ（サイズは持たない。新しい仕事の材料は 4×8 から始まる）。
 * builtIn：最初から入っている材料の印（並び順のため）。noCut：木取りしない（第2.5版）
 */
export type MaterialSpec = SpecMaterial

/**
 * ひな形の材料グループ（第1.5版のフラッシュ）：中身は材料の id ではなく材料名＋厚みで持つ
 * （新しい仕事の材料は新しい id になるため。createJob で同じ材料名＋厚みの材料に直す）。
 * 第2.5版で芯材（core）をなくし、form・autoName を足した（以前のひな形は migrateFlushSpecCores で移す）
 */
export type FlushSpec = SpecGroup

export interface SettingsTemplate {
  /** 刃厚・端切り・切り代・切り方・逃げ（id ごと） */
  settings: Settings
  /** 材料（保存の並び＝job.boards の並び） */
  materials: MaterialSpec[]
  /** フラッシュ（登録順。第1.5版） */
  flushes: FlushSpec[]
}

/** 初めて使うときのひな形：設定は初期値、材料は メラミン1・ラワン2.5・4・5.5。呼ぶたびに新しいオブジェクト */
export function defaultTemplate(): SettingsTemplate {
  const list: [string, number][] = [
    ['メラミン', 1],
    ['ラワン', 2.5],
    ['ラワン', 4],
    ['ラワン', 5.5],
  ]
  return {
    settings: defaultSettings(),
    materials: list.map(([material, thickness]) => ({ material, thickness, builtIn: true })),
    flushes: [],
  }
}

/**
 * 仕事の設定と材料（材料名・厚み・印）・材料グループを写したひな形（深いコピー。サイズは入れない）。
 * 以前の版の芯材（core）が残っているフラッシュは、芯材◯（木取りしない）の材料と中身に移してから写す（第2.5版）
 */
export function templateOf(source: Job): SettingsTemplate {
  let n = 0
  const moved = source.flushes.some((f) => f.core !== undefined)
    ? migrateFlushCores(source.boards, source.flushes, () => `__core-${++n}`)
    : null
  const job: Job = moved ? { ...source, ...moved } : source
  return {
    settings: { ...job.settings, nige: job.settings.nige.map((n) => ({ ...n })) },
    materials: job.boards.map((b) => {
      const m: MaterialSpec = { material: b.material, thickness: b.thickness }
      if (isBuiltInBoard(b, job)) m.builtIn = true
      if (b.noCut === true) m.noCut = true
      return m
    }),
    flushes: job.flushes.map((f) => {
      const spec: FlushSpec = {
        name: f.name,
        faces: f.faces.flatMap((x) => {
          const b = job.boards.find((y) => y.id === x.boardId)
          return b ? [{ material: b.material, thickness: b.thickness, count: x.count }] : []
        }),
      }
      if (f.stack === true) spec.stack = true
      if (f.form !== undefined) spec.form = f.form
      if (f.autoName === true) spec.autoName = true
      return spec
    }),
  }
}

/** 2つのひな形の中身が同じか */
export function sameTemplate(a: SettingsTemplate, b: SettingsTemplate): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b))
}

/** 比べるためにキーの並びをそろえる */
function normalized(t: SettingsTemplate) {
  const s = t.settings
  return {
    settings: {
      kerf: s.kerf,
      trim: s.trim,
      allowance: s.allowance,
      cutMode: s.cutMode,
      nige: s.nige.map((n) => ({ id: n.id, name: n.name, value: n.value })),
    },
    materials: t.materials.map((m) => ({
      material: m.material,
      thickness: m.thickness,
      builtIn: m.builtIn === true,
      noCut: m.noCut === true,
    })),
    flushes: t.flushes.map((f) => ({
      name: f.name,
      faces: f.faces.map((x) => ({ material: x.material, thickness: x.thickness, count: x.count })),
      stack: f.stack === true,
      form: f.form ?? 'flush',
      autoName: f.autoName === true,
    })),
  }
}

// 最後に使った設定（ひな形）。新しい仕事・見本はこれを写して作る（仕様書 4「設定の引き継ぎ」、architecture.md 8.3）
import { isBuiltInBoard } from '../engine/boards'
import { defaultSettings } from '../engine/defaults'
import type { Job, Settings } from '../engine/types'

/** ひな形の材料：材料名と厚みだけ（サイズは持たない。新しい仕事の材料は 4×8 から始まる） */
export interface MaterialSpec {
  material: string
  thickness: number
  /** 最初から入っている材料の印（並び順のため） */
  builtIn?: true
}

export interface SettingsTemplate {
  /** 刃厚・端切り・切り代・切り方・逃げ（id ごと） */
  settings: Settings
  /** 材料（保存の並び＝job.boards の並び） */
  materials: MaterialSpec[]
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
  }
}

/** 仕事の設定と材料（材料名・厚み・印）を写したひな形（深いコピー。サイズは入れない） */
export function templateOf(job: Job): SettingsTemplate {
  return {
    settings: { ...job.settings, nige: job.settings.nige.map((n) => ({ ...n })) },
    materials: job.boards.map((b) => {
      const m: MaterialSpec = { material: b.material, thickness: b.thickness }
      if (isBuiltInBoard(b, job)) m.builtIn = true
      return m
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
    materials: t.materials.map((m) => ({ material: m.material, thickness: m.thickness, builtIn: m.builtIn === true })),
  }
}

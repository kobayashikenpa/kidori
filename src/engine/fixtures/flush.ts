// フラッシュの見本（仕様書 4「フラッシュ」の例）：フラッシュ25（芯材15×1・メラミン1×2・ラワン4×2）で天板を2枚。
// 芯材は「芯材15（木取りしない）」の材料（第2.5版。以前の芯材 core の形は fixtures/legacyFlush.ts だけが作る）
import { defaultSettings } from '../defaults'
import type { Board, Job, Part } from '../types'

export const MELAMINE_1_ID = 'board-melamine-1'
export const LAUAN_4_ID = 'board-lauan-4'
export const FLUSH_25_ID = 'flush-25'
export const CORE_15_ID = 'board-core-15'

/** 芯材15（木取りしない・4×8。以前のデータを移し替えたときと同じ形） */
function core15(): Board {
  return { id: CORE_15_ID, material: '芯材', thickness: 15, sizeKind: 'shihachi', width: 1220, length: 2440, grain: 'long', noCut: true }
}

/** テスト用の部材（足りない項目は初期値） */
export function flushPart(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
  return {
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

/** 天板（W900・H25・D600、フラッシュ25、2枚、木目 W）だけの仕事。材料は 3×6（芯材15 は材料の最後）。フラッシュ25 は form: 'flush'・autoName: true */
export function flushJob(): Job {
  const sheet = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
  return {
    id: 'job-flush',
    name: 'フラッシュの机',
    settings: defaultSettings(),
    boards: [
      { id: MELAMINE_1_ID, material: 'メラミン', thickness: 1, ...sheet },
      { id: LAUAN_4_ID, material: 'ラワン', thickness: 4, ...sheet },
      core15(),
    ],
    flushes: [
      {
        id: FLUSH_25_ID,
        name: 'フラッシュ25',
        faces: [
          { boardId: CORE_15_ID, count: 1 },
          { boardId: MELAMINE_1_ID, count: 2 },
          { boardId: LAUAN_4_ID, count: 2 },
        ],
        form: 'flush',
        autoName: true,
      },
    ],
    parts: [
      flushPart({
        id: 'part-tenban',
        name: '天板',
        flushId: FLUSH_25_ID,
        expr: { W: '900', H: '25', D: '600' },
        quantity: 2,
        grain: 'W',
      }),
    ],
    frozenSheets: [],
    stackSheets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

export const LAUAN_25_ID = 'board-lauan-2.5'
export const LAUAN_55_ID = 'board-lauan-5.5'
export const SAMPLE_FLUSH_ID = 'flush-sample-25'

/**
 * 第1.7版の見本（S-14。id は固定）を第2.5版の材料グループの形にしたもの。
 * 材料は メラミン1・ラワン2.5・ラワン4・ラワン5.5（3×6）と、最後に 芯材15（木取りしない・4×8）。
 * フラッシュ25 の中身は 芯材15×1・メラミン1×2・ラワン4×2、form: 'flush'・autoName: true。
 * 組（メラミン1＋ラワン4）の設定も 3×6（第2.3版）。stack を true にすると第2.0版の見本（フラッシュ25 の重ね切りオン）
 */
export function sampleGroupJob(stack = false): Job {
  const sheet = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
  const settings = defaultSettings()
  settings.nige = [{ id: 'nige-1', name: '逃げ', value: 1 }]
  const t = `{t:${SAMPLE_FLUSH_ID}}`
  return {
    id: 'job-sample',
    name: '本棚 W900',
    settings,
    boards: [
      { id: MELAMINE_1_ID, material: 'メラミン', thickness: 1, ...sheet, builtIn: true },
      { id: LAUAN_25_ID, material: 'ラワン', thickness: 2.5, ...sheet, builtIn: true },
      { id: LAUAN_4_ID, material: 'ラワン', thickness: 4, ...sheet, builtIn: true },
      { id: LAUAN_55_ID, material: 'ラワン', thickness: 5.5, ...sheet, builtIn: true },
      core15(),
    ],
    flushes: [
      {
        id: SAMPLE_FLUSH_ID,
        name: 'フラッシュ25',
        faces: [
          { boardId: CORE_15_ID, count: 1 },
          { boardId: MELAMINE_1_ID, count: 2 },
          { boardId: LAUAN_4_ID, count: 2 },
        ],
        ...(stack ? { stack: true as const } : {}),
        form: 'flush',
        autoName: true,
      },
    ],
    parts: [
      flushPart({ id: 'part-zentai', name: '全体', expr: { W: '900', H: '1800', D: '400' }, quantity: 0 }),
      flushPart({ id: 'part-gawa', name: '側板', flushId: SAMPLE_FLUSH_ID, expr: { W: t, H: '全体.H', D: '全体.D' }, quantity: 2, grain: 'H' }),
      flushPart({ id: 'part-tenchi', name: '天地板', flushId: SAMPLE_FLUSH_ID, expr: { W: '全体.W - 側板.W * 2', H: t, D: '全体.D' }, quantity: 2, grain: 'W' }),
      flushPart({ id: 'part-tana', name: '棚板', flushId: SAMPLE_FLUSH_ID, expr: { W: '天地板.W - {n:nige-1}', H: t, D: '全体.D - 20' }, quantity: 4, grain: 'W' }),
      flushPart({ id: 'part-ita', name: '背板', boardId: LAUAN_4_ID, expr: { W: '全体.W', H: '全体.H', D: `{t:${LAUAN_4_ID}}` }, quantity: 1, grain: 'H', allowance: 0 }),
    ],
    frozenSheets: [],
    // 見本の組（メラミン 1＋ラワン 4）の設定は 3×6（第2.3版。store の見本と同じ）
    stackSheets: [{ boardIds: [MELAMINE_1_ID, LAUAN_4_ID], ...sheet }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

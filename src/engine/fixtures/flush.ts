// フラッシュの見本（仕様書 4「フラッシュ」の例）：フラッシュ25（芯材15・メラミン1×2・ラワン4×2）で天板を2枚
import { defaultSettings } from '../defaults'
import type { Job, Part } from '../types'

export const MELAMINE_1_ID = 'board-melamine-1'
export const LAUAN_4_ID = 'board-lauan-4'
export const FLUSH_25_ID = 'flush-25'

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

/** 天板（W900・H25・D600、フラッシュ25、2枚、木目 W）だけの仕事。材料は 3×6 */
export function flushJob(): Job {
  const sheet = { sizeKind: 'saburoku', width: 910, length: 1820, grain: 'long' } as const
  return {
    id: 'job-flush',
    name: 'フラッシュの机',
    settings: defaultSettings(),
    boards: [
      { id: MELAMINE_1_ID, material: 'メラミン', thickness: 1, ...sheet },
      { id: LAUAN_4_ID, material: 'ラワン', thickness: 4, ...sheet },
    ],
    flushes: [
      {
        id: FLUSH_25_ID,
        name: 'フラッシュ25',
        core: 15,
        faces: [
          { boardId: MELAMINE_1_ID, count: 2 },
          { boardId: LAUAN_4_ID, count: 2 },
        ],
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

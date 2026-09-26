// 見本データ（本棚 W900）。テストで使う。期待する値は docs/tasks.md の「見本」の表を参照
import { defaultNige } from '../defaults'
import { BOARD_SIZES, DEFAULT_SETTINGS, type Board, type Job, type Part } from '../types'

export const LUMBER_18_ID = 'board-shina-lumber-18'
export const VENEER_4_ID = 'board-shina-veneer-4'

function part(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
  return {
    boardId: null,
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

/** 見本の仕事を新しく作って返す（呼ぶたびに別のオブジェクト） */
export function bookshelfJob(): Job {
  const [width, length] = BOARD_SIZES.saburoku
  const boards: Board[] = [
    { id: LUMBER_18_ID, material: 'シナランバー', thickness: 18, sizeKind: 'saburoku', width, length, grain: 'long' },
    { id: VENEER_4_ID, material: 'シナベニヤ', thickness: 4, sizeKind: 'saburoku', width, length, grain: 'long' },
  ]
  const parts: Part[] = [
    part({ id: 'part-zentai', name: '全体', expr: { W: '900', H: '1800', D: '400' }, quantity: 0 }),
    part({
      id: 'part-gawaita',
      name: '側板',
      boardId: LUMBER_18_ID,
      expr: { W: '18', H: '全体.H', D: '全体.D' },
      quantity: 2,
      grain: 'H',
    }),
    part({
      id: 'part-tenchiita',
      name: '天地板',
      boardId: LUMBER_18_ID,
      expr: { W: '全体.W - 側板.W * 2', H: '18', D: '全体.D' },
      quantity: 2,
      grain: 'W',
    }),
    part({
      id: 'part-tanaita',
      name: '棚板',
      boardId: LUMBER_18_ID,
      expr: { W: '天地板.W', H: '18', D: '全体.D - 20' },
      quantity: 4,
      grain: 'W',
      clearance: { W: 1 },
    }),
    part({
      id: 'part-seita',
      name: '背板',
      boardId: VENEER_4_ID,
      expr: { W: '全体.W', H: '全体.H', D: '4' },
      quantity: 1,
      grain: 'H',
      allowance: 0,
    }),
  ]
  return {
    id: 'job-bookshelf-w900',
    name: '本棚 W900',
    settings: { ...DEFAULT_SETTINGS, nige: defaultNige() },
    boards,
    parts,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

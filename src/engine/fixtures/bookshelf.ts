// 見本データ（本棚 W900）。テストで使う。期待する値は docs/tasks.md の「見本」の表を参照
// 第2.1版から、設定の切り代はフラッシュの部材だけに足す（フラッシュでない部材は 0）。
// この見本はシナランバー（フラッシュでない）なので、表の木取り寸法（切り代 10）のままにするため、
// 側板・天地板・棚板に部材ごとの切り代 10（LUMBER_ALLOWANCE）を入れている
import { defaultNige } from '../defaults'
import { BOARD_SIZES, DEFAULT_SETTINGS, type Board, type Job, type Part } from '../types'

export const LUMBER_18_ID = 'board-shina-lumber-18'
export const VENEER_4_ID = 'board-shina-veneer-4'
/** 側板・天地板・棚板の部材ごとの切り代（第2.1版から上書きで入れる） */
export const LUMBER_ALLOWANCE = 10

function part(p: Partial<Part> & Pick<Part, 'id' | 'name' | 'expr'>): Part {
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
      allowance: LUMBER_ALLOWANCE,
    }),
    part({
      id: 'part-tenchiita',
      name: '天地板',
      boardId: LUMBER_18_ID,
      expr: { W: '全体.W - 側板.W * 2', H: '18', D: '全体.D' },
      quantity: 2,
      grain: 'W',
      allowance: LUMBER_ALLOWANCE,
    }),
    part({
      id: 'part-tanaita',
      name: '棚板',
      boardId: LUMBER_18_ID,
      expr: { W: '天地板.W - {n:nige-1}', H: '18', D: '全体.D - 20' },
      quantity: 4,
      grain: 'W',
      allowance: LUMBER_ALLOWANCE,
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
    flushes: [],
    parts,
    frozenSheets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

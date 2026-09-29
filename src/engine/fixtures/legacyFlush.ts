// 以前の版（第2.4版まで）の形の見本：フラッシュの芯材を厚み（core）で持つ。移し替え（migrate/flushCore.ts）のテストだけが使う
import type { LegacyFlush } from '../migrate/flushCore'
import type { Job } from '../types'
import { sampleGroupJob } from './flush'

/** 以前の版の仕事の形（フラッシュが core を持つ） */
export type LegacyJob = Omit<Job, 'flushes'> & { flushes: LegacyFlush[] }

/**
 * 移し替えを戻した形：「芯材」の木取りしない材料をなくし、中身のその行を core（厚み×枚数）に戻す。form・autoName も外す。
 * 芯材の中身が無いフラッシュは form・autoName を外すだけ
 */
export function toLegacyJob(job: Job): LegacyJob {
  const cores = new Map(job.boards.filter((b) => b.material === '芯材' && b.noCut).map((b) => [b.id, b.thickness]))
  return {
    ...job,
    boards: job.boards.filter((b) => !cores.has(b.id)),
    flushes: job.flushes.map(({ form: _f, autoName: _a, ...f }) => {
      const c = f.faces.find((x) => cores.has(x.boardId))
      return c ? { ...f, core: cores.get(c.boardId)! * c.count, faces: f.faces.filter((x) => x !== c) } : f
    }),
  }
}

/** 第2.4版の見本（芯材 core 15・材料に芯材は無い・form／autoName なし）。sampleGroupJob(stack) を戻したもの */
export function legacySampleFlushJob(stack = false): LegacyJob {
  return toLegacyJob(sampleGroupJob(stack))
}

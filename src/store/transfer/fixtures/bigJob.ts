// テスト用：見本（本棚 W900）に部材を足して、部材 n 行の仕事を作る（ファイルの大きさ・負荷の確かめ用）
import type { Job, Part } from '../../../engine/types'
import { newPart } from '../../jobs'
import { sampleFromTemplate } from '../../sample'
import { defaultTemplate } from '../../template'

export function bigJob(rows: number, now: Date, name = `部材${rows}の仕事`): Job {
  const job = sampleFromTemplate(defaultTemplate(), now)
  const flush = job.flushes.find((f) => f.name === 'フラッシュ25')!
  const lauan4 = job.boards.find((b) => b.material === 'ラワン' && b.thickness === 4)!
  const nige1 = job.settings.nige.find((n) => n.value === 1)!
  const parts: Part[] = [...job.parts]
  for (let i = parts.length; i < rows; i++) {
    const useFlush = i % 3 !== 0
    parts.push(
      newPart({
        name: `部材${i + 1}`,
        ...(useFlush ? { flushId: flush.id } : { boardId: lauan4.id }),
        expr: useFlush
          ? { W: `${200 + ((i * 37) % 500)} - {n:${nige1.id}}`, H: `{t:${flush.id}}`, D: `全体.D - ${i % 50}` }
          : { W: `${150 + ((i * 53) % 600)}`, H: `${100 + ((i * 29) % 400)}`, D: `{t:${lauan4.id}}` },
        quantity: 1 + (i % 3),
        grain: useFlush ? 'W' : 'any',
        memo: i % 4 === 0 ? `メモ${i + 1}：木口テープ貼り` : '',
      }),
    )
  }
  return { ...job, name, parts }
}

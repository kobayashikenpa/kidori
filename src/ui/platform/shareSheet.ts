// ファイルを送る（第2.4版。architecture.md 16.4）。
// 共有シートが使えれば navigator.share でファイルを渡し、使えなければ端末に保存（ダウンロード）する。
// iPhone の Safari は押した操作から続いていない共有を断るので、押した操作の中で同期に呼ぶこと。

/** 保存（ダウンロード）したときに出す知らせ（暫定。未決事項 53） */
export const SAVED_MESSAGE = 'ファイルを保存しました。LINE などからこのファイルを送ってください'

/** shared：共有シートで送った／cancelled：閉じた（何も出さない）／saved：端末に保存した／failed：保存もできなかった */
export type ShareResult = 'shared' | 'cancelled' | 'saved' | 'failed'

function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true
  } catch {
    return false
  }
}

/** Blob の URL と <a download> で端末に保存する */
export function downloadFile(file: File): boolean {
  try {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // すぐに消すと保存が始まらないブラウザがあるので、少し待ってから消す
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return true
  } catch {
    return false
  }
}

/** ファイルを送る。閉じたときは 'cancelled'（何も出さない） */
export async function shareFile(file: File, title: string): Promise<ShareResult> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // ほかの失敗（押した操作から続いていない等）は保存にする
    }
  }
  return downloadFile(file) ? 'saved' : 'failed'
}

/** 結果ごとに画面に出す文（出さないときは null） */
export function shareResultMessage(r: ShareResult): string | null {
  if (r === 'saved') return SAVED_MESSAGE
  if (r === 'failed') return 'ファイルを作れませんでした'
  return null
}

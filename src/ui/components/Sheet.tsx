// 下から出る編集シート。背景を押すか「閉じる」で閉じる。
// 重ねて開いたとき（部材の編集の上の設定の画面など）は、Escape でいちばん上のシートだけを閉じる
import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  /** 閉じるボタンの文字（初めは「閉じる」。「×」なら読み上げは「閉じる」） */
  closeText?: string
}

export function Sheet({ title, onClose, children, closeText = '閉じる' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const all = document.querySelectorAll('.sheet-backdrop')
      if (all[all.length - 1] === ref.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div ref={ref} className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className={closeText === '閉じる' ? 'btn' : 'btn sheet-x'}
            aria-label={closeText === '閉じる' ? undefined : '閉じる'}
            onClick={onClose}
          >
            {closeText}
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

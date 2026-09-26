// 見出しを押すと説明が浮かび上がる（仕様書 9.1）。もう一度押すか、ほかを押すか、Esc で消える。開くのは1つだけ
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { claimOpen } from '../exclusive'

interface Props {
  /** 見出しの文字 */
  title: ReactNode
  /** 説明 */
  children: ReactNode
  /** 見出しの見た目（label＝入力欄の見出し、そのほかは h2・h3 の中で使う） */
  className?: string
}

export function Help({ title, children, className }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const release = claimOpen('help', close)
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && wrapRef.current?.contains(e.target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      btnRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      release()
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // 吹き出しが画面の横からはみ出さないように、左右をずらす
  useLayoutEffect(() => {
    const b = bubbleRef.current
    if (!open || !b) return
    b.style.transform = ''
    const r = b.getBoundingClientRect()
    const margin = 8
    const vw = document.documentElement.clientWidth
    let shift = 0
    if (r.right > vw - margin) shift = vw - margin - r.right
    if (r.left + shift < margin) shift = margin - r.left
    if (shift !== 0) b.style.transform = `translateX(${shift}px)`
  }, [open])

  return (
    <span className={`help${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="help-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        <span className="help-mark" aria-hidden="true">
          ⓘ
        </span>
      </button>
      {open && (
        <span className="help-bubble" id={id} role="note" ref={bubbleRef}>
          {children}
        </span>
      )}
    </span>
  )
}

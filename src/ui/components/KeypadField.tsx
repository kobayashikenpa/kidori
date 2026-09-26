// 数字の入力欄（仕様書 9.1）。<input> を使わず数字を見せる枠にするので、押してもスマホのキーボードは出ない。
// 枠を押すと画面の下にアプリの数字キーが出る。開いた直後に数字を押すと入れ替え、⌫ は1字消す。ほかを押すか「決定」で閉じる
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { claimOpen } from '../exclusive'
import { closeKeyboard } from '../keyboard'
import { pressKey } from '../numpad'
import { keepAbovePad } from '../scroll'

interface Props {
  /** 見せている文字（打っている途中も含む） */
  text: string
  /** 数字キーを押すたびに呼ぶ */
  onText: (t: string) => void
  /** 閉じたときに呼ぶ */
  onClose?: () => void
  /** 「決定」（または Enter）で閉じたときだけ、onClose のあとに呼ぶ（入力欄の登録など） */
  onDone?: () => void
  /** 数字キーを開いたときに呼ぶ（打ち始めの文字を用意するため） */
  onOpen?: () => void
  /** 整数だけか（「.」のキーを出さない） */
  integer?: boolean
  bad?: boolean
  unit?: string
  placeholder?: string
  id?: string
  /** 見出し（読み上げと、数字キーの上に出す名前） */
  ariaLabel?: string
}

export function KeypadField({ text, onText, onClose, onDone, onOpen, integer = false, bad, unit = 'mm', placeholder, id, ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState(false)
  const boxRef = useRef<HTMLButtonElement>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const doneRef = useRef(onDone)
  const padId = `${useId()}-pad`

  const press = (key: string) => {
    onText(pressKey(text, key, fresh && key !== 'back', integer))
    setFresh(false)
  }
  const pressRef = useRef(press)
  useEffect(() => {
    closeRef.current = onClose
    doneRef.current = onDone
    pressRef.current = press
  })

  useEffect(() => {
    if (!open) return
    const close = () => {
      setOpen(false)
      closeRef.current?.()
    }
    const release = claimOpen('pad', close)
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (boxRef.current?.contains(t) || padRef.current?.contains(t))
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        close()
        boxRef.current?.focus()
        if (e.key === 'Enter') doneRef.current?.()
      } else if (/^[\d.]$/.test(e.key)) pressRef.current(e.key)
      else if (e.key === 'Backspace') pressRef.current('back')
      else return
      e.preventDefault()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    // 数字キーに入力欄が隠れないように動かす
    let restore = () => {}
    const frame = requestAnimationFrame(() => {
      if (boxRef.current && padRef.current) restore = keepAbovePad(boxRef.current, padRef.current)
    })
    return () => {
      release()
      cancelAnimationFrame(frame)
      restore()
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const openPad = () => {
    if (open) return
    closeKeyboard()
    onOpen?.()
    setFresh(true)
    setOpen(true)
  }
  const done = () => {
    setOpen(false)
    closeRef.current?.()
    doneRef.current?.()
  }
  // キーを押しても枠から注目が外れないようにする
  const keep = (e: ReactPointerEvent) => e.preventDefault()
  const key = (label: string, k: string, cls = 'num', aria?: string) => (
    <button type="button" className={`pad-key ${cls}`} aria-label={aria} onPointerDown={keep} onClick={() => press(k)}>
      {label}
    </button>
  )

  return (
    <span className="unit-input">
      <button
        ref={boxRef}
        id={id}
        type="button"
        className={`input num keypad-box${open ? ' active' : ''}${bad ? ' bad' : ''}`}
        aria-label={`${ariaLabel ?? ''} ${text || '空'}`.trim()}
        aria-expanded={open}
        aria-controls={padId}
        aria-invalid={bad || undefined}
        onClick={openPad}
      >
        {text === '' ? (
          <span className="keypad-placeholder">{placeholder}</span>
        ) : (
          <span className={open && fresh ? 'keypad-fresh' : undefined}>{text}</span>
        )}
        {open && <span className="caret" aria-hidden="true" />}
      </button>
      {unit && <span className="unit">{unit}</span>}
      {open &&
        createPortal(
          <div className="numpad" id={padId} ref={padRef} role="group" aria-label={`${ariaLabel ?? '数'}の数字キー`}>
            <div className="numpad-in">
              <div className="numpad-show num" aria-live="polite">
                <span className="numpad-name">{ariaLabel}</span>
                <span className={`numpad-val${bad ? ' bad' : ''}`}>
                  {text === '' ? '―' : text} {unit}
                </span>
              </div>
              <div className="pad-keys numpad-keys">
                {key('7', '7')}
                {key('8', '8')}
                {key('9', '9')}
                {key('⌫', 'back', '', '1字消す')}
                {key('4', '4')}
                {key('5', '5')}
                {key('6', '6')}
                {key('クリア', 'clear', '')}
                {key('1', '1')}
                {key('2', '2')}
                {key('3', '3')}
                <button type="button" className="pad-key done numpad-done" onPointerDown={keep} onClick={done}>
                  決定
                </button>
                {integer ? (
                  <button type="button" className="pad-key num span3" onPointerDown={keep} onClick={() => press('0')}>
                    0
                  </button>
                ) : (
                  <>
                    <button type="button" className="pad-key num span2" onPointerDown={keep} onClick={() => press('0')}>
                      0
                    </button>
                    {key('.', '.')}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}

/** 入力欄から注目を外して、キーボードを閉じる（出たままだと、次に押したボタンで画面が動いて確認が見えなくなる） */
export function closeKeyboard() {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

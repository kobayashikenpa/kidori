// 数字キー（KeypadField）の1回の入力。画面から切り離して試せるようにする

/** 入れられる桁の数（小数点を含む） */
const MAX_LEN = 8

/** 数字キーを1つ押したあとの文字。fresh（開いた直後）なら数字は入れ替え */
export function pressKey(text: string, key: string, fresh: boolean, integer: boolean): string {
  if (key === 'back') return text.slice(0, -1)
  if (key === 'clear') return ''
  const base = fresh ? '' : text
  if (key === '.') {
    if (integer) return text
    if (base === '') return '0.'
    return base.includes('.') ? base : `${base}.`
  }
  if (!/^\d$/.test(key)) return text
  if (base.length >= MAX_LEN) return base
  return base === '0' ? key : base + key
}

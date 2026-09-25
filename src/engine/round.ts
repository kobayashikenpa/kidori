// 寸法の比較用：浮動小数の誤差で判定がずれないよう、小数第1位に丸めてから比べる

/** 小数第1位に丸める */
export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** 小数第1位に丸めて同じ値か */
export function eq1(a: number, b: number): boolean {
  return round1(a) === round1(b)
}

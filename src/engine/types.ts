// kidori の計算で使うデータの形と初期値。寸法はすべて mm の number。

/** 寸法の軸。家具として組み立てたときの向き（W：幅、H：高さ、D：奥行き） */
export type Axis = 'W' | 'H' | 'D'

export const AXES: readonly Axis[] = ['W', 'H', 'D']

// ---------- 入力 ----------

/** 切り方：縦切り優先 / 横切り優先 / おまかせ */
export type CutMode = 'vertical' | 'horizontal' | 'auto'

/** 逃げ（仕事ごと）。名前は持たず、表示のたびに value から「逃げ{value}」を作る（nigeName） */
export interface Nige {
  /** 仕事の中で重複しない。式からはこの id で参照する（{n:id}） */
  id: string
  /** mm。0 より大きい */
  value: number
}

/** 仕事ごとの設定 */
export interface Settings {
  /** 刃厚（初期値 3） */
  kerf: number
  /**
   * 端切り（耳落とし。初期値 5）。この幅は刃厚を含む。
   * 縦切り優先は右の長手だけ、横切り優先は上の長手と右の妻手を落とす
   */
  trim: number
  /** 切り代（初期値 10）。部材ごとに上書きできる */
  allowance: number
  /** 切り方（初期値 縦切り優先） */
  cutMode: CutMode
  /**
   * 逃げ。登録順＝画面の並び順。画面から足すときは、同じ値（小数第1位で比較）を重ねて登録しない。
   * 以前の版から移した逃げは丸めないので、0.25 と 0.3 のように小数第1位で同じになる値が並ぶことがある
   */
  nige: Nige[]
}

/** 設定の数値の初期値。逃げは配列なので含めない（新しい設定は defaults.ts の defaultSettings() で作る） */
export const DEFAULT_SETTINGS: Readonly<Omit<Settings, 'nige'>> = {
  kerf: 3,
  trim: 5,
  allowance: 10,
  cutMode: 'vertical',
}

/** 板のサイズの種類：サブロク 910×1820 / シハチ 1220×2440 / 自由入力 */
export type BoardSizeKind = 'saburoku' | 'shihachi' | 'custom'

/** 定尺板の大きさ［短辺, 長辺］ */
export const BOARD_SIZES: Readonly<Record<Exclude<BoardSizeKind, 'custom'>, readonly [number, number]>> = {
  saburoku: [910, 1820],
  shihachi: [1220, 2440],
}

/** 板の木目の方向：長辺方向 / 短辺方向 */
export type BoardGrain = 'long' | 'short'

/** 板（材料）。材料名＋厚みで区別する。同じ組み合わせの板は2つ作れない */
export interface Board {
  id: string
  /** 材料名（例：シナランバー） */
  material: string
  /** 厚み（mm） */
  thickness: number
  sizeKind: BoardSizeKind
  /** 短辺（mm） */
  width: number
  /** 長辺（mm） */
  length: number
  /** 木目の方向。初期値 'long'。サブロク・シハチは 'long' 固定 */
  grain: BoardGrain
}

/** 部材の木目：板の面になる2つの軸のどちらか、または「どちらでもよい」 */
export type PartGrain = Axis | 'any'

/** 加工のチェック（部材ごと。枚数ごとではない） */
export interface PartChecks {
  /** 仕上がり寸法の加工が終わった */
  finished: boolean
  /** 木取り寸法の加工（切り出し）が終わった */
  cut: boolean
}

/** 部材 */
export interface Part {
  id: string
  /** 仕事の中で重複不可。式の参照に使う */
  name: string
  /** 使う板（材料名＋厚み）。枚数0の行（全体など）は null でよい */
  boardId: string | null
  /** W・H・D の入力（数値または式の文字列） */
  expr: Record<Axis, string>
  /** 手で選んだ厚みの寸法。null は自動判定 */
  thicknessAxis: Axis | null
  /** 枚数（0 は切り出さない寸法だけの行） */
  quantity: number
  grain: PartGrain
  /** 切り出した後の加工など。空文字＝なし */
  memo: string
  /** 加工のチェック */
  checks: PartChecks
  /** 切り代の上書き。null は仕事の初期値 */
  allowance: number | null
}

/** 仕事 */
export interface Job {
  id: string
  name: string
  settings: Settings
  boards: Board[]
  /** 並び順＝画面の並び順 */
  parts: Part[]
  /** ISO 文字列 */
  createdAt: string
  updatedAt: string
}

// ---------- 寸法の計算結果 ----------

export type DimensionErrorKind =
  | 'syntax' // 式が読めない
  | 'unknownRef' // 存在しない部材名を参照
  | 'cycle' // 循環参照
  | 'nonPositive' // 計算結果が 0 以下
  | 'divideByZero' // 0 で割った
  | 'missingBoard' // 式が使っている材料の厚みの材料が削除されている
  | 'missingNige' // 式が使っている逃げが削除されている

export interface DimensionError {
  partId: string
  axis: Axis
  kind: DimensionErrorKind
  /** 画面にそのまま出せる日本語 */
  message: string
  /** unknownRef の部材名、cycle の部材名の並び */
  refs?: string[]
  /**
   * エラーのある寸法を参照しているために計算できないとき、元のエラーがある寸法。
   * 自分の式にエラーがあるときは付かない
   */
  from?: { partId: string; axis: Axis }
}

export interface PartDimensions {
  partId: string
  name: string
  quantity: number
  boardId: string | null
  /** 式の計算結果。エラーがあれば null。第1.1版からは finished と同じ値 */
  input: Record<Axis, number> | null
  /** 仕上がり寸法（式の計算結果。逃げは式の中で引く） */
  finished: Record<Axis, number> | null
  /** 採用した厚みの寸法 */
  thicknessAxis: Axis | null
  /** 自動判定で決めたか */
  thicknessAuto: boolean
  /** 厚みの寸法の値 ≠ 板の厚み（確認を促す） */
  thicknessMismatch: boolean
  /** 板の面になる2軸（W→H→D の順） */
  faceAxes: [Axis, Axis] | null
  /** 実際に使った切り代 */
  allowance: number
  /** 木取り寸法（面の2軸だけ切り代を足す。厚みの軸はそのまま） */
  cutSize: Record<Axis, number> | null
  errors: DimensionError[]
}

export interface DimensionResult {
  /** 入力の並び順 */
  parts: PartDimensions[]
  /** 全部材のエラー */
  errors: DimensionError[]
}

// ---------- 木取りの結果 ----------

/**
 * 板の置き方（配置図の向き）。
 * - portrait（縦長、縦切り優先）：x は短辺（妻手）方向 0〜width、y は長辺（長手）方向 0〜length
 * - landscape（横長、横切り優先）：x は長辺（長手）方向 0〜length、y は短辺（妻手）方向 0〜width
 */
export type SheetOrientation = 'portrait' | 'landscape'

/**
 * 板の上の長方形。その板の置き方（SheetOrientation）の座標で、左下を原点とする（x は右が +、y は上が +）。
 * 配置図の上＝奥、右＝端切りをした側
 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placement extends Rect {
  /** `${partId}#${連番}` */
  pieceId: string
  partId: string
  name: string
  /** 部材の face[0] を板の長辺（長手）方向に置いたとき false（置き方によらない） */
  rotated: boolean
  /** 配置図に出す寸法（例："1810×410"） */
  sizeLabel: string
}

/** 配置図の上で 縦に切る（線が y 方向）/ 横に切る（線が x 方向）。縦長に置いたときは 縦＝長辺と平行 */
export type CutDirection = 'vertical' | 'horizontal'

export interface CutStep {
  /** 1 から */
  no: number
  direction: CutDirection
  /** 切る線の位置：vertical なら x、horizontal なら y */
  at: number
  /** 切る範囲（この長方形を2つに分ける） */
  within: Rect
  /** 端切り（耳落とし）/ 帯を切る / 帯を切り分ける / 幅を切り揃える */
  kind: 'trim' | 'strip' | 'crosscut' | 'rip'
  /** 画面用の日本語（例：「右端から 410mm で縦に切る」） */
  label: string
}

export interface SheetLayout {
  /** その材料の何枚目か（1 から） */
  index: number
  /** 短辺 */
  boardWidth: number
  /** 長辺 */
  boardLength: number
  /**
   * 配置図の向き。portrait なら図の大きさは boardWidth×boardLength、
   * landscape なら boardLength（横）×boardWidth（縦）。ほかの Rect はすべてこの向きの座標
   */
  orientation: SheetOrientation
  /** 端切りで落とす部分（切る順番と同じ並び）。端切り0 なら空 */
  trims: Rect[]
  /** 端切り後に使える範囲 */
  usable: Rect
  placements: Placement[]
  cuts: CutStep[]
  /** 端材 */
  scraps: Rect[]
  /** 部材（木取り寸法）の面積の合計 */
  usedArea: number
  /** 歩留まり 0〜1 */
  yieldRate: number
}

export interface MaterialResult {
  boardId: string
  material: string
  thickness: number
  /** 実際に使った切り方（おまかせなら選ばれたほう） */
  mode: 'vertical' | 'horizontal'
  sheets: SheetLayout[]
  /** 必要な板の枚数 */
  sheetCount: number
  /** この材料全体の歩留まり */
  yieldRate: number
  /** 板に入らない部材 */
  unplaced: { partId: string; name: string; reason: 'tooLarge' }[]
}

export interface PackingResult {
  /** 板の登録順 */
  materials: MaterialResult[]
  /** 全体の歩留まり */
  totalYieldRate: number
  skipped: { partId: string; name: string; reason: 'dimensionError' | 'noThickness' | 'noBoard' }[]
}

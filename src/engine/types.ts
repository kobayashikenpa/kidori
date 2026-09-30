// kidori の計算で使うデータの形と初期値。寸法はすべて mm の number。

/** 寸法の軸。家具として組み立てたときの向き（W：幅、H：高さ、D：奥行き） */
export type Axis = 'W' | 'H' | 'D'

export const AXES: readonly Axis[] = ['W', 'H', 'D']

// ---------- 入力 ----------

/** 切り方：縦切り優先 / 横切り優先 / おまかせ */
export type CutMode = 'vertical' | 'horizontal' | 'auto'

/**
 * 調整寸法（旧：逃げ。仕事ごと）。逃げ・ほぞなど。表示名は「名前＋寸法」（nigeName。例：逃げ1、ほぞ15）。
 * 名前と寸法の両方が同じものは重ねない（同じ名前で寸法違い、同じ寸法で名前違いは別の項目）
 */
export interface Nige {
  /** 仕事の中で重複しない。式からはこの id で参照する（{n:id}） */
  id: string
  /** 名前（例：逃げ、ほぞ）。空でない。第1.3版までのデータには無く、読み込むときに「逃げ」にする */
  name: string
  /** mm。0 より大きい */
  value: number
}

/** 仕事ごとの設定 */
export interface Settings {
  /** 刃厚（初期値 3） */
  kerf: number
  /**
   * 端切り（耳落とし。初期値 5）。この幅は刃厚を含む。
   * 縦切り優先は右の長手だけ、横切り優先は下の長手と右の妻手を落とす（第1.8版までに保存した写しは上の長手）
   */
  trim: number
  /** 切り代（初期値 10）。部材ごとに上書きできる */
  allowance: number
  /** 切り方（初期値 縦切り優先） */
  cutMode: CutMode
  /**
   * 調整寸法（逃げ）。登録順＝画面の並び順。画面から足すときは、名前と値（小数第1位で比較）の両方が同じものを重ねて登録しない。
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

/**
 * まとめの1行のサイズの設定（第2.3版。architecture.md 15.2）。材料の行は Board、重ね切りの組の行は StackSheet がこの形を持つ
 */
export interface SheetChoice {
  sizeKind: BoardSizeKind
  /** 短辺（mm） */
  width: number
  /** 長辺（mm） */
  length: number
  /** 木目の方向。初期値 'long'。サブロク・シハチは 'long' 固定 */
  grain: BoardGrain
  /** 自由入力（＝手持ちで木取り。第2.2版）を選んでいる。オンのときだけ true を持つ */
  stockOn?: true
  /** 手持ちの材料（登録順）。3×6／4×8 に戻しても消さずに残す（切り替えて戻せるように） */
  stock?: StockSheet[]
}

/** 板（材料）。材料名＋厚みで区別する。同じ組み合わせの板は2つ作れない */
export interface Board extends SheetChoice {
  id: string
  /** 材料名（例：ラワン） */
  material: string
  /** 厚み（mm） */
  thickness: number
  /**
   * 新しい仕事に最初から入っている材料の印（defaultBoards が付ける）。あとから足した材料には付けない。
   * 画面の並び順（boards.ts の orderedBoards）に使う。第1.1版までのデータには無い
   */
  builtIn?: true
  /**
   * 木取りしない（第2.5版。仕様書 4）：厚みの計算には使うが、片を作らない（例：芯材15）。オンのときだけ true を持つ
   */
  noCut?: true
}

/**
 * 重ね切りの組の行のサイズの設定（第2.3版）。組は2つの材料で決まる（違うフラッシュでも同じ2つの材料なら1つの組）。
 * 行が無い組は、2つの材料の行のサイズがそろえばそのサイズ、違えば 4×8。片方が手持ちならもう片方のサイズ、両方が手持ちなら 4×8（第2.6版。packing/stock.ts の stackChoice）
 */
export interface StackSheet extends SheetChoice {
  /** 組の2つの材料（a・b。材料の保存の並び）。探すときは並びを問わない */
  boardIds: [string, string]
}

/** 手持ちの材料の1行（第2.2版）。例：4×8 ×3枚 */
export interface StockSheet {
  /** その材料の中で重複しない */
  id: string
  /** 3×6／4×8／自由入力 */
  sizeKind: BoardSizeKind
  /** 短辺（3×6・4×8 は決まった値） */
  width: number
  /** 長辺 */
  length: number
  /** 3×6・4×8 は 'long' */
  grain: BoardGrain
  /** 枚数（1以上の整数） */
  count: number
}

/** 部材の木目：板の面になる2つの軸のどちらか、または「どちらでもよい」 */
export type PartGrain = Axis | 'any'

/** 加工のチェック（部材ごと。枚数ごとではない） */
export interface PartChecks {
  /** 仕上がり寸法の加工が終わった */
  finished: boolean
  /** 木取り寸法の加工（切り出し）が終わった。フラッシュの部材では使わない（cutByBoard） */
  cut: boolean
  /**
   * フラッシュの部材の、表面材（材料の id）ごとの木取りの完了（第1.5版）。true の表面材は木取りから除く。
   * 以前のデータ・フラッシュでない部材には無い
   */
  cutByBoard?: Record<string, boolean>
}

/** 部材 */
export interface Part {
  id: string
  /** 仕事の中で重複不可。式の参照に使う */
  name: string
  /** 使う板（材料名＋厚み）。枚数0の行（全体など）は null でよい。フラッシュを選んだ部材は null */
  boardId: string | null
  /** 材料のかわりに選んだフラッシュの id（第1.5版）。無ければ材料（boardId）を使う */
  flushId?: string
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

/** フラッシュの表面材：登録済みの材料と、1部材あたりの枚数 */
export interface FlushFace {
  boardId: string
  /** 1以上の整数 */
  count: number
}

/** 材料グループの初めの形（第2.5版）。自動の名前の頭に使う（フラッシュ／ベタ／グループ） */
export type GroupForm = 'flush' | 'beta' | 'empty'

/**
 * 材料グループ（画面の言葉。コードは第1.5版からの Flush のまま。仕様書 4、architecture.md 17章）：
 * 材料 × 枚数を並べたもの。厚み＝中身の合計（flush.ts の flushThickness）。
 * 対応：Flush・job.flushes＝材料グループ、faces＝中身、Board.noCut＝木取りしない、form＝初めの形
 */
export interface Flush {
  /** 仕事の中で重複しない。部材の flushId・式の {t:id} から参照する */
  id: string
  /** 名前（例：フラッシュ25）。空でなく、ほかのフラッシュと重ならない */
  name: string
  /**
   * 中身（同じ材料を重ねない。順番・芯材／表面材の区別に意味は持たせない）。
   * 以前の版の芯材の厚み（core）は、読み込むときに「芯材◯（木取りしない）」の中身へ移す（migrate/flushCore.ts の LegacyFlush だけが知っている）
   */
  faces: FlushFace[]
  /**
   * 表面材を重ねて切る（第2.0版〜第2.5版）。第2.6版からは計算では見ない（仕事ごとの Job.stacking に置き換え。
   * 以前のデータの移し替えだけに使う。architecture.md 18.7・18.8）。前の版のアプリのため、保存データからは消さない
   */
  stack?: true
  /** 初めの形（第2.5版）。無ければ 'flush'（以前のデータ） */
  form?: GroupForm
  /** 名前を自動でつけている（中身を変えると名前がついてくる。第2.5版）。オンのときだけ true */
  autoName?: true
}

/** 仕事 */
export interface Job {
  id: string
  name: string
  settings: Settings
  boards: Board[]
  /** フラッシュ（第1.5版）。登録順＝画面の並び順。以前のデータは読み込むときに [] */
  flushes: Flush[]
  /** 並び順＝画面の並び順 */
  parts: Part[]
  /** 固定した1枚（第1.8版。固定した順）。以前のデータは読み込むときに [] */
  frozenSheets: FrozenSheet[]
  /**
   * 重ね切りの組の行のサイズの設定（第2.3版）。組ごとに1つ（並びを問わず同じ2つの材料の行は1つだけ）。
   * 以前のデータは読み込むときに作る（architecture.md 15.6）
   */
  stackSheets: StackSheet[]
  /**
   * この仕事でユーザーが削除した最初から入っている材料（第2.5.1版）。キーは builtInKey（材料名＋厚み）。
   * 読み込むときに最初の材料を自動で足すが、ここにあるものは足し直さない。無い・空なら省略
   */
  removedBuiltIns?: string[]
  /**
   * 重ね切り（第2.6版。仕事ごと。architecture.md 18.7）。'on' なら材料グループの部材の、違う材料の同じ片を2枚重ねて切る。
   * 読み込んだあとはいつもある（無い以前のデータは読み込むときに1回決める。18.8）。新しい仕事は 'on'
   */
  stacking: 'on' | 'off'
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
  | 'thicknessMismatch' // 厚みの寸法の値が材料の厚みと合わない（自動で見つからないときを含む。枚数1以上・材料ありの部材だけ）

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
  /** 厚みの寸法の値 ≠ 板の厚み。true なら errors にも thicknessMismatch のエラーが入る（第1.2版からエラー） */
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
  /** 手持ちで木取りした1枚（第2.2版）：使った手持ちの行と木目。サイズを選んだ材料では持たない */
  sheet?: {
    stockId: string
    sizeKind: BoardSizeKind
    grain: BoardGrain
    /** 重ねた板の端材から取った1枚（第2.6版）。source は「重ねた板◯」の番号（計算した・固定したときのもの） */
    offcut?: { source: number }
  }
}

/**
 * 入らない部材の理由。tooLarge：選んだサイズのどの向きにも入らない。
 * noStock（第2.2版）：手持ちで木取りする材料で、手持ちが足りない・手持ちのどの大きさにも入らない
 */
export type UnplacedReason = 'tooLarge' | 'noStock'

export interface MaterialResult {
  boardId: string
  material: string
  thickness: number
  /** 実際に使った切り方（おまかせなら選ばれたほう） */
  mode: 'vertical' | 'horizontal'
  sheets: SheetLayout[]
  /** 必要な板の枚数。第2.6版から、端材から取った1枚（sheet.offcut あり）は数えない */
  sheetCount: number
  /** 端材から取った1枚の数（第2.6版） */
  offcutSheetCount: number
  /** この材料全体の歩留まり */
  yieldRate: number
  /** 板に入らない部材 */
  unplaced: { partId: string; name: string; reason: UnplacedReason }[]
  /**
   * 重ね切りの組の結果（第2.0版）。このとき boardId は stackKey(a, b)、material・thickness は1つ目の材料 a のもの。
   * 1枚は a・b の両方の1枚として数える
   */
  stack?: { boardIds: [string, string] }
}

export interface PackingResult {
  /** 板の登録順 */
  materials: MaterialResult[]
  /** 全体の歩留まり */
  totalYieldRate: number
  /**
   * 計算から除いた部材。thicknessMismatch：厚みの寸法が材料の厚みと合わない（第1.2版）。
   * noThickness は第1.2版からは出ない（厚みが決まらない部材は thicknessMismatch になる）。型は以前のまま残す
   */
  skipped: { partId: string; name: string; reason: 'dimensionError' | 'thicknessMismatch' | 'noThickness' | 'noBoard' }[]
  /**
   * 木取り済み（寸法表で木取りの「完了」＝ checks.cut）で計算から除いた部材（第1.3版。仕様書 8）。
   * 部材の並び順。枚数0の行は含めない。材料が無い・寸法のエラーがあっても skipped ではなくこちらに入る。
   * フラッシュの部材（第1.5版）は完了にした表面材ごとに1行（quantity＝表面材の枚数×部材の枚数、boardId＝表面材）
   */
  done: { partId: string; name: string; quantity: number; boardId: string | null }[]
  /** 重ね切りの組（第2.6版）。accepted は重ねた組、rejected は重ねると材料が増えるので重ねなかった組（組の並び） */
  stacks: { accepted: StackPair[]; rejected: StackPair[] }
}

/** 重ね切りの組（第2.6版）：2つの違う材料（a・b は材料の保存の並び）。key は stackKey(a, b) */
export interface StackPair {
  key: string
  boardIds: [string, string]
}

// ---------- 切りながら進める木取り（第1.8版） ----------

/**
 * 固定した1枚（第1.8版。architecture.md 11.2）。1つ目の部材にチェックしたときに、画面に出ていた1枚を写して作る。
 * 部材や設定が変わっても、この写しは変わらない
 */
export interface FrozenSheet {
  /** 仕事の中で重複しない */
  id: string
  /** 切っている材料（フラッシュの表面材なら表面材の材料） */
  boardId: string
  /** 固定したときの材料名（材料を削除・変更しても表示できるように） */
  material: string
  /** 固定したときの材料の厚み */
  thickness: number
  /** 固定したときの材料の木目の方向 */
  grain: BoardGrain
  /** 固定したときの切り方（おまかせなら選ばれたほう） */
  mode: 'vertical' | 'horizontal'
  /** 固定したときの刃厚（残りの材料の計算に使う） */
  kerf: number
  /** 固定したときの端切り */
  trim: number
  /** 固定したときの1枚（深いコピー。index は使わない＝表示のときに振り直す） */
  layout: SheetLayout
  /** チェックした片の pieceId（layout.placements にあるものだけ・重複なし） */
  checked: string[]
  /** ISO */
  frozenAt: string
  /** すべての片にチェックした時刻（ISO）。あれば「切り終わり」 */
  completedAt?: string
  /**
   * 重ね切りの1枚（第2.0版）：boardId（組の1つ目の材料）と一緒に重ねて切った、もう1つの材料（固定したときの写し）。
   * 片は両方の材料から切ったものとして数える
   */
  stackWith?: { boardId: string; material: string; thickness: number }
}

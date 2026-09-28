# kidori 設計（第1版・第1.1版・第1.2版・第1.3版・第1.4版・第1.5版・第1.8版・第2.0版・第2.2版・第2.3版）

仕様の正は `docs/spec.md`。この文書は「どこに何を作るか」「データの形」「計算の流れ」を決める。
仕様書に書いていないことで、ここで仮に決めたものには **（暫定）** を付け、`docs/tasks.md` 末尾の未決事項に挙げている。
計画係（planner）が決めたものには **決定（planner）** を付けている。

> **第1.1版の変更は 6章にまとめている。** 1〜5章と 6章が食い違うところは 6章が正（例：部材ごとの逃げ `Part.clearance` は第1.1版でなくなる）。
> **第1.2版の変更は 7章にまとめている。** 6章までと食い違うところは 7章が正。
> **第1.3版の変更は 8章にまとめている。** 7章までと食い違うところは 8章が正。
> **第1.8版（切りながら進める木取り）の変更は 11章にまとめている。** 切り出しのチェック（8.5・10.3・`checklist.ts`）と食い違うところは 11章が正。
> **第2.0版（フラッシュの重ね切り）の変更は 12章にまとめている。** 木取りの材料の分け方（3.3・10.3）・固定した1枚（11章）と食い違うところは 12章が正。
> **第2.2版（手持ちの材料）の変更は 14章にまとめている。** 帯詰め（3.3）・重ね切りの組（12.3・12.4）・まとめ（11.5・13.3）と食い違うところは 14章が正。
> **第2.3版（まとめの行ごとのサイズ・自由入力＝手持ち・厚みの置き換え）の変更は 15章にまとめている。** 重ね切りの組のサイズ（12.3・12.6・12.8）・手持ち（14章）と食い違うところは 15章が正。

## 1. 全体の構成

```
src/
  engine/            計算ロジック（React・ui・store を import しない）
    types.ts           データ型（入力・計算結果・木取り結果）と初期値
    fixtures/
      bookshelf.ts     見本データ（本棚 W900）。テストで使う
    formula/
      tokenize.ts      式 → 字句（数値・参照・記号）
      parse.ts         字句 → 構文木（AST）
      evaluate.ts      構文木の計算、参照の取り出し
    dimensions/
      resolve.ts       参照の依存関係の整理（計算順・循環・存在しない部材）
      finished.ts      仕上がり寸法（式の計算 − 逃げ）
      thickness.ts     厚みの寸法の判定・不一致の確認
      cutSize.ts       木取り寸法（仕上がり ＋ 切り代）
      index.ts         computeDimensions(job)：寸法表のデータを返す
    packing/
      pieces.ts        部材を1枚ずつの「切り出す片」に展開・板ごとに分ける・木目で向きを決める
      sheet.ts         板の使える範囲（耳落とし）と、刃厚込みで入るかの判定
      guillotine.ts    帯詰め（縦切り優先／横切り優先）の配置
      cutOrder.ts      切る順番の組み立て
      scraps.ts        端材の取り出し
      yield.ts         歩留まり
      index.ts         packJob(job, dims)：おまかせの比較を含む入口
  store/             仕事データの状態管理と保存
    jobs.ts            仕事・板・部材の追加／変更／削除（純粋関数）
    storage.ts         localStorage の読み書き（try/catch）
    JobStore.tsx       React の Context + useReducer、変更時の自動保存
  ui/                画面（React）
    App.tsx            画面の切り替え（下のタブ）
    screens/
      JobsScreen.tsx       仕事
      PartsScreen.tsx      部材（一覧・編集）
      DimensionScreen.tsx  寸法表
      KidoriScreen.tsx     木取り（結果）
      SettingsScreen.tsx   設定（刃厚など・板）
    components/
      FormulaInput.tsx     式の入力（参照ボタン・演算子ボタン）
      PartEditor.tsx       部材の編集シート
      DimensionTable.tsx   寸法表の表（1部材1行）
      SheetDiagram.tsx     配置図（SVG）
      CutSteps.tsx         切る順番
      BoardEditor.tsx      板の追加・編集
```

- 画面の切り替えはルーター用のパッケージを使わず、状態（今のタブ）で切り替える（依存を増やさない）
- 計算の呼び出しは画面側で `computeDimensions` → `packJob` の順。`useMemo` で部材・設定が変わったときだけ計算し直す

## 2. データ型（`src/engine/types.ts`）

寸法は mm の number。比較は小数第1位に丸めてから行い、表示も小数第1位まで。

```ts
/** 寸法の軸（家具として組み立てたときの向き） */
export type Axis = 'W' | 'H' | 'D'

// ---------- 入力 ----------

export type CutMode = 'vertical' | 'horizontal' | 'auto' // 縦切り優先 / 横切り優先 / おまかせ

export interface Settings {
  kerf: number        // 刃厚（初期値 3）
  trim: number        // 端切り（耳落とし。初期値 5）。刃厚を含む。縦切り優先は右の長手、横切り優先は下の長手と右の妻手
  allowance: number   // 切り代（初期値 10）。部材ごとに上書きできる
  cutMode: CutMode    // 初期値 'vertical'
}

export type BoardSizeKind = 'saburoku' | 'shihachi' | 'custom' // サブロク 910×1820 / シハチ 1220×2440 / 自由入力

export interface Board {
  id: string
  material: string      // 材料名（例：シナランバー）
  thickness: number     // 厚み（mm）
  sizeKind: BoardSizeKind
  width: number         // 短辺（mm）
  length: number        // 長辺（mm）
  grain: 'long' | 'short' // 木目の方向。初期値 'long'。サブロク・シハチは 'long' 固定
}
// 板は「材料名＋厚み」で区別する。同じ組み合わせの板は2つ作れない

/** 部材の木目：板の面になる2つの軸のどちらか、または「どちらでもよい」 */
export type PartGrain = Axis | 'any'

export interface Part {
  id: string
  name: string                    // 仕事の中で重複不可。式の参照に使う
  boardId: string | null          // 使う板（材料名＋厚み）。枚数0の行（全体など）は null でよい
  expr: Record<Axis, string>      // W・H・D の入力（数値または式の文字列）
  thicknessAxis: Axis | null      // 手で選んだ厚みの寸法。null は自動判定
  quantity: number                // 枚数（0 は切り出さない寸法だけの行）
  grain: PartGrain
  clearance: Partial<Record<Axis, number>> // 逃げ。板の面になる軸だけ有効
  allowance: number | null        // 切り代の上書き。null は仕事の初期値
}

export interface Job {
  id: string
  name: string
  settings: Settings
  boards: Board[]
  parts: Part[]       // 並び順＝画面の並び順
  createdAt: string   // ISO 文字列
  updatedAt: string
}

// ---------- 寸法の計算結果 ----------

export type DimensionErrorKind =
  | 'syntax'          // 式が読めない
  | 'unknownRef'      // 存在しない部材名を参照
  | 'cycle'           // 循環参照
  | 'nonPositive'     // 計算結果が 0 以下
  | 'divideByZero'    // 0 で割った

export interface DimensionError {
  partId: string
  axis: Axis
  kind: DimensionErrorKind
  message: string     // 画面にそのまま出せる日本語
  refs?: string[]     // unknownRef の部材名、cycle の部材名の並び
  from?: { partId: string; axis: Axis } // エラーのある寸法を参照して計算できないとき、元のエラーの寸法
}

export interface PartDimensions {
  partId: string
  name: string
  quantity: number
  boardId: string | null
  input: Record<Axis, number> | null       // 式の計算結果。エラーがあれば null
  finished: Record<Axis, number> | null    // 仕上がり寸法（入力 − 逃げ）
  thicknessAxis: Axis | null               // 採用した厚みの寸法
  thicknessAuto: boolean                   // 自動判定で決めたか
  thicknessMismatch: boolean               // 厚みの寸法の値 ≠ 板の厚み（確認を促す）
  faceAxes: [Axis, Axis] | null            // 板の面になる2軸（W→H→D の順）
  allowance: number                        // 実際に使った切り代
  cutSize: Record<Axis, number> | null     // 木取り寸法（面の2軸だけ切り代を足す。厚みの軸はそのまま）
  errors: DimensionError[]
}

export interface DimensionResult {
  parts: PartDimensions[]   // 入力の並び順
  errors: DimensionError[]  // 全部材のエラー
}

// ---------- 木取りの結果 ----------

/** 板の置き方（配置図の向き）。portrait：縦長（縦切り優先）、landscape：横長（横切り優先） */
export type SheetOrientation = 'portrait' | 'landscape'

/** 板の上の長方形。その板の置き方の座標で、左下を原点とする（x は右が +、y は上が +）。
 *  portrait：x は短辺方向 0〜width、y は長辺方向 0〜length
 *  landscape：x は長辺方向 0〜length、y は短辺方向 0〜width */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Placement extends Rect {
  pieceId: string     // `${partId}#${連番}`
  partId: string
  name: string
  rotated: boolean    // 部材の face[0] を板の長辺方向に置いたとき false（置き方によらない）
  sizeLabel: string   // 配置図に出す寸法（例："1810×410"）
}

export type CutDirection = 'vertical' | 'horizontal' // 配置図の上で縦に切る（線が y 方向）/ 横に切る（線が x 方向）

export interface CutStep {
  no: number              // 1 から
  direction: CutDirection
  /** 切る線の位置：vertical なら x、horizontal なら y */
  at: number
  /** 切る範囲（この長方形を2つに分ける） */
  within: Rect
  kind: 'trim' | 'strip' | 'crosscut' | 'rip' // 端切り / 帯を切る / 帯を切り分ける / 幅を切り揃える
  label: string           // 画面用の日本語（例：「右端から 410mm で縦に切る」）
}

export interface SheetLayout {
  index: number           // その材料の何枚目か（1 から）
  boardWidth: number      // 短辺
  boardLength: number     // 長辺
  orientation: SheetOrientation // 配置図の向き。landscape なら図は boardLength（横）× boardWidth（縦）
  trims: Rect[]           // 端切りで落とす部分（切る順番と同じ並び）。端切り0 なら空
  usable: Rect            // 端切り後に使える範囲
  placements: Placement[]
  cuts: CutStep[]
  scraps: Rect[]          // 端材
  usedArea: number        // 部材（木取り寸法）の面積の合計
  yieldRate: number       // 歩留まり 0〜1
}

export interface MaterialResult {
  boardId: string
  material: string
  thickness: number
  mode: 'vertical' | 'horizontal'  // 実際に使った切り方（おまかせなら選ばれたほう）
  sheets: SheetLayout[]
  sheetCount: number               // 必要な板の枚数
  yieldRate: number                // この材料全体の歩留まり
  unplaced: { partId: string; name: string; reason: 'tooLarge' }[] // 板に入らない部材
}

export interface PackingResult {
  materials: MaterialResult[]      // 板の登録順
  totalYieldRate: number           // 全体の歩留まり
  // 計算から除いた部材（枚数0の行は含めない）。dimensionError：式・寸法のエラー、
  // noThickness：式は正しいが厚みの寸法（板の面）が決まらない、noBoard：板が未設定・存在しない
  skipped: { partId: string; name: string; reason: 'dimensionError' | 'noThickness' | 'noBoard' }[]
}
```

- 初期値は `DEFAULT_SETTINGS = { kerf: 3, trim: 5, allowance: 10, cutMode: 'vertical' }`、板サイズは `BOARD_SIZES = { saburoku: [910, 1820], shihachi: [1220, 2440] }` として同じファイルに置く

## 3. 計算の流れ

### 3.1 式（`formula/`）

- 字句：数値（小数可）、参照 `部材名.W|H|D`、`+ - * / ( )`、空白。画面のボタンの `×` `÷` は入力時に `*` `/` に置き換えて式に入れる
- 入力の揺れをそろえる（`normalizeFormulaText`）：字句に分ける前に、NFKC で全角の数字・記号・英字を半角にし（`９００` `＋` `（` `．` `Ｗ` など）、`×` `✕` → `*`、`÷` → `/`、`−` `–` `—` → `-` に置き換える。長音の `ー` は置き換えない。字句の位置（エラーの位置）は入力したままの文字の位置で返す
- 部材名は `normalizePartName`（同じ NFKC）でそろえてから参照と照らし合わせる。全角・半角の違いだけの名前は重複とみなし、全角の記号（`＋` `×` など）を含む名前も使えない
- 参照の読み取り：記号・空白で区切ったひとかたまりの文字列が「部材名.W|H|D」（`.` はちょうど1つ）なら参照、`12.5` のような数字だけなら数値とする。部材名に `.` は使えないので、数字で始まる部材名（例：`2段目棚板.W`）も数値と区別でき、使える
- 構文：普通の四則演算の優先順位。先頭や `(` の直後の `-` は符号として扱う
- 結果は `{ ok: true, value }` か `{ ok: false, error }` の形で返し、例外は投げない

### 3.2 寸法（`dimensions/`）

1. すべての部材の W・H・D の式から参照を取り出し、`部材.軸` を点とした依存関係を作る
2. 存在しない部材名 → `unknownRef`。依存関係を順に並べ（トポロジカル順）、並べられないもの → `cycle`（関係する部材名を示す）
3. 計算順に：入力値 = 式の計算結果 → 仕上がり = 入力値 − 逃げ（面の2軸のみ）
   - **参照先の値は仕上がり寸法**（逃げを引いた後）
   - 仕上がりが 0 以下 → `nonPositive`
   - エラーのある寸法を参照している寸法も計算しない（元のエラーを示す）
4. 厚みの寸法：`thicknessAxis` が手で選ばれていればそれ。なければ W・H・D のうち板の厚みと等しい（小数第1位で比較）最初の軸。見つからなければ null。選んだ軸の値が板の厚みと違えば `thicknessMismatch = true`
   - 逃げは面の2軸だけに効くため、厚みの軸は「入力値」で判定する
   - 自分の軸を参照する部材（例：W = `A.H`、H 18、逃げ H1）では、判定には自分の逃げを引く前の値を使う（W は 18 と見て厚みは W）。判定用の値は仕上がり寸法の計算とは別に持ち、参照にはいつも逃げを引いた後の値を渡す（W の仕上がりは 17。厚みの寸法の値が板と違うので不一致の印が付く）
   - ほかの部材を通って、自分の厚みの判定が自分の逃げを引いた値に戻ってくる場合（P.W = `Q.W`、Q.W = `P.H`、P に逃げ H）は循環参照にする。どの部材から計算しても同じ結果になる
5. 木取り寸法 = 仕上がり ＋ 切り代（面の2軸それぞれに1回足す）。切り代は `partAllowance`：`part.allowance`（0 も有効な値）があればそれ、無ければ フラッシュの部材は `settings.allowance`・フラッシュでない部材は 0（第2.1版。13.1）

### 3.3 木取り（`packing/`）

**板の置き方**：切り方で変わる。どちらも左下が原点、y は上が +（配置図の上＝奥）。端切りの幅は刃厚を含む。
- 縦切り優先：縦長（`portrait`）。x = 短辺方向（0〜width）、y = 長辺方向（0〜length）。端切りは右の長手：使える範囲は `x: 0〜(width − trim)`、`y: 0〜length`
- 横切り優先：横長（`landscape`、妻手が右）。x = 長辺方向（0〜length）、y = 短辺方向（0〜width）。端切りは下の長手 → 右の妻手の順（右下の角の矩を出す。第1.9版から。部材は右上から詰める）：使える範囲は `x: 0〜(length − trim)`、`y: trim〜width`（サブロク・端切り5 なら 1815×905）。第1.8版までに保存した固定した1枚は上の長手を落とした写しのまま扱う（`sheetProgress` は端切りで `usable` のある側を残す）
- `sheet.ts` の `usableRect(board, trim, mode)`・`trimRects(board, trim, mode)`・`sheetOrientation(mode)`

**片の展開と向き**（`pieces.ts`）
- `quantity ≥ 1` かつ寸法にエラーがなく板のある部材を、1枚ずつの片にする。`boardId` ごとに分ける
- 片の向きは板の辺に対して決める（`Orientation` の x＝短辺方向、y＝長辺方向。置き方によらない）：板の木目が長辺方向なら、部材の木目の軸の木取り寸法を長辺方向（y）に置く。短辺方向なら x に置く。`any` は回転してよい（配置時に両方試す）。横長に置くときは長辺方向が図の横になる（`frameOf` で直す）
- どう回しても使える範囲に入らない片は `unplaced`。横切り優先は長手も端切りするので横長の範囲で判定する。おまかせは広いほう（縦切り優先）で判定し、横切り優先の配置で入らない片は配置の段階で `unplaced` になる

**刃厚込みの入り判定**（`sheet.ts`）
- 長さ L の中に片 s1…sn を並べる条件：`Σs + kerf × (n − 1) ≤ L`（最後の片の外側は端材側に刃厚を負担させる）（暫定）

**帯詰め**（`guillotine.ts`）— 縦切り優先・横切り優先とも、その置き方の座標で同じ処理
1. 片を「帯の幅（x 方向）の大きい順 → 長さ（y 方向）の大きい順」に並べる
2. 1片ずつ、開いている板の帯を先頭から見て、**幅が収まり、残りの長さに刃厚込みで入る最初の帯** に置く（First Fit）
3. 入る帯がなければ、今の板の残り幅（左側）に新しい帯を作る。帯の幅は最初に置いた片の幅
4. 板の残り幅にも入らなければ、新しい板を出す
5. **右から詰める**：最初の帯は使える範囲の右端（x = width − trim）に接して置き、次の帯はその左に刃厚をあけて置く。余りは左側に残る
6. 帯の中では片を **上端（y = length、配置図の上＝奥）から下へ** 刃厚をあけて順に並べる（決定：未決事項9）。帯より細い片は、帯の右端に寄せ、左の余りは端材にする。片は右上から左下に向かって埋まり、端材は左と帯の下（左下）に残る
   - 例（見本 1枚目）：側板 410×1810 は x 495〜905・y 10〜1820、次の側板は x 82〜492・y 10〜1820

横切り優先は、同じ処理を横長に置いた板で行う。帯は妻手の幅いっぱい（y 0〜width − trim）で右から左へ並び、帯の幅は片の長辺方向の大きさ。帯の中は上から詰める。長手がだんだん短くなり、妻手の幅のままの余りが左に残る。
  - 例（見本 1枚目・横切り優先）：側板 1810×410 は x 5〜1815・y 495〜905、次の側板は x 5〜1815・y 82〜492

**計算量**：片 n 枚・帯 m 本で O(n × m)。100枚超でも一瞬で終わる。

**おまかせ**（`index.ts`）：縦切り優先・横切り優先の両方を材料ごとに計算し、入らない片が少ないほう → 必要な板が少ないほう → 一番大きい端材が大きいほう → 縦切り優先 の順で採る（未決事項2）

**切る順番**（`cutOrder.ts`）：板ごとに次の順で並べる
1. 端切り：縦切り優先は右の長手（縦に切る）。横切り優先は下の長手（横に切る）→ 右の妻手（縦に切る）
2. 右の帯から順に、帯を切り離す（縦に切る）
3. その帯を、上から片ごとに切り分ける（横に切る）
4. 帯より細い片は幅を切り揃える（縦に切る）
- 縦・横は配置図の上で見た向き（横長の図でも、図の縦の線は「縦に切る」）
- ラベルの位置は、その時点で残っている板（切る範囲 `within`）の端から測る（決定：未決事項11）
  - 縦に切る：「右端から ◯mm」、横に切る：「上端から ◯mm」（どちらの切り方でも）
  - 刃厚は測った側の反対側（余りの側）で消える：縦は線の左、横は線の下。端切りは刃厚を含む
  - 例（見本 1枚目・縦切り優先）：1 端切り（x=905）→ 2 右端から 410mm で縦（x=495）→ 3 上端から 1810mm で横（y=10）→ 4 右端から 410mm で縦（x=82）→ 5 上端から 1810mm で横（y=10）
  - 例（見本 1枚目・横切り優先）：1 端切り：下の長手（y=5）→ 2 端切り：右の妻手（x=1815）→ 3 右端から 1810mm で縦（x=5）→ 4 上端から 410mm で横（y=500）→ 5 上端から 410mm で横（y=87）

**端材**（`scraps.ts`）：板の左側の残り、各帯の残り長さ（帯の下側）、帯より細い片の横の残りを長方形で返す。刃厚ぶんは差し引いた大きさ。幅・長さとも 30mm（`MIN_SCRAP`）以上のものだけ出す（未決事項10）

**歩留まり**（`yield.ts`）
- 板1枚：置いた片の木取り寸法の面積の合計 ÷ 板全体の面積（端切り前、width × length。置き方によらない）（決定：未決事項1）
- 材料ごと・全体：面積の合計 ÷ 板の面積の合計

## 4. 保存（`src/store`）

- localStorage のキー：`kidori.jobs.v1` に `{ version: 1, jobs: Job[] }`、`kidori.currentJobId` に開いている仕事の id
- 読み込み・書き込みはすべて try/catch。読めない・壊れているときは空の一覧で始め、画面に「保存データを読めませんでした」と出す（データは上書きしない）
- 書き込みは状態が変わるたびに行う（入力中の連打に備えて 300ms ほどまとめる）
- `jobs.ts` の操作（純粋関数）
  - `createJob(name)`：初期設定・板なし・部材なしの仕事
  - `addPart / updatePart / removePart`：名前の重複は拒否。名前を変えたとき、ほかの部材の式の参照もつけ替える（暫定）
  - `addBoard / updateBoard / removeBoards`：材料名＋厚みの重複は拒否。`partsUsingBoard(job, boardId)` で使っている部材名を返し、画面で確認してから削除。削除したら該当部材の `boardId` は null
- id は `crypto.randomUUID()`

## 5. 画面（`src/ui`）

幅 375px 前後、横スクロールなし、押せる部分は高さ 44px 以上、ライト／ダーク両対応。下に5つのタブ：**仕事・部材・寸法表・木取り・設定**。仕事を開いていないときは「仕事」以外を押せない。

| 画面 | 内容 |
|---|---|
| 仕事 | 保存した仕事の一覧（名前・更新日）。新しく作る・開く |
| 部材 | 部材カードの一覧（名前・板・枚数・W×H×D・エラー表示）。押すと編集シート。追加ボタン |
| 部材の編集 | 名前、板（材料名＋厚みから選ぶ）、W・H・D（式の入力）、厚みの寸法（自動／W／H／D）、枚数、木目（面の2軸＋どちらでもよい）、逃げ（面の2軸それぞれ）、切り代（空欄＝初期値） |
| 式の入力 | 入力欄の下に、登録済みの部材の寸法ボタン（`全体.W` など。編集中の部材自身は出さない）、`+ − × ÷ ( )`、数字・小数点・1字消す。キーボードでも打てる。エラーは欄のすぐ下に日本語で |
| 寸法表 | 1部材1行の表（第1.7版でカードは廃止）。部材・枚数・**仕上がり寸法** W・H・D・仕上がりの完了。木取り寸法は出さない（木取り画面で見る）。数字を押すと内訳、厚み不一致の注意 |
| 木取り | 材料ごとに：必要な板の枚数・歩留まり・切り方。板ごとに配置図（SVG）、切る順番、端材。入らない部材・計算できない部材の一覧。全体の歩留まり |
| 設定 | 刃厚・耳落とし・切り代（よく使う値のボタン＋数値入力）・切り方。板の一覧と追加・編集・削除（使っている部材がある場合は部材名を示して確認） |

**配置図**（`SheetDiagram.tsx`）：`viewBox` を板の寸法（mm）にして画面幅に合わせる。`sheet.orientation` が landscape なら長辺を横にする。端切り（`sheet.trims`）・部材（名前と寸法）・端材を色分け。y は上が + なので描くときに反転する。

---

## 6. 第1.1版の変更（実機で使ってみての改善）

仕様書 4（逃げ）・5.1・5.2（メモ）・5.4・6・9（お知らせ・加工のチェック・メモ）・10 の変更に対応する。材料と逃げは仕事ごと（決定（オーナー））。

### 6.1 追加・変更するファイル

```
src/engine/
  types.ts               Nige・Settings.nige・Part.memo・Part.checks を追加、Part.clearance を削除
  defaults.ts            defaultNige()・defaultBoards(newId)・nigeName()・boardTokenLabel()
  formula/
    tokenize.ts          材料の厚み・逃げの字句 {t:…} {n:…} を読む
    parse.ts / evaluate.ts  厚み・逃げの値を受け取って計算する
    units.ts             式を「カーソルで動く単位」に分ける（ボタン入力と表示用）
    display.ts           単位を画面の表示名に変える（ラワン4mm、逃げ1mm など）
    usages.ts            材料の厚み・逃げを使っている部材の一覧、id のつけ替え
  dimensions/finished.ts 逃げの処理をなくし、仕上がり寸法 = 式の計算結果 にする
  migrate/clearance.ts   以前の版の部材ごとの逃げを、設定の逃げ＋式に移す
  migrate/v1Dimensions.ts 以前の版の寸法の計算（移し替えの前後で寸法が変わらないかを確かめるためだけに使う）
  hints/saving.ts        材料を減らせるときのお知らせ
src/store/
  storage.ts             保存データ第2版（キー kidori.jobs.v2）と第1版からの移し替え
  jobs.ts                新しい仕事の初期値（材料・逃げ）、逃げの追加・変更・削除、メモ・チェック
src/ui/
  formulaEdit.ts         カーソル（単位の番号）での挿入・左右移動・1字消す・全部消す
  components/FormulaInput.tsx  キーボードを出さない式の入力
  components/NigeEditor.tsx    設定の画面の逃げの一覧
  components/SavingHints.tsx   木取りの画面のお知らせ
```

### 6.2 データ型の変更（`types.ts`）

```ts
/** 逃げ（仕事ごと）。名前は持たず、表示のたびに value から「逃げ{value}mm」を作る */
export interface Nige {
  id: string      // 仕事の中で重複しない。式からはこの id で参照する
  value: number   // mm。0 より大きい
}

export interface Settings {
  kerf: number
  trim: number
  allowance: number
  cutMode: CutMode
  nige: Nige[]    // 登録順＝画面の並び順。同じ値（小数第1位で比較）は重ねて登録しない
}

export interface PartChecks {
  finished: boolean  // 仕上がり寸法の加工が終わった
  cut: boolean       // 木取り寸法の加工（切り出し）が終わった
}

export interface Part {
  id: string
  name: string
  boardId: string | null
  expr: Record<Axis, string>
  thicknessAxis: Axis | null
  quantity: number
  grain: PartGrain
  memo: string            // 切り出した後の加工など。空文字＝なし
  checks: PartChecks      // 部材ごと（枚数ごとではない）
  allowance: number | null
  // clearance は削除（逃げは式の中で引く）
}

export type DimensionErrorKind =
  | 'syntax' | 'unknownRef' | 'cycle' | 'nonPositive' | 'divideByZero'
  | 'missingBoard'  // 式が使っている材料の厚みの材料が削除されている
  | 'missingNige'   // 式が使っている逃げが削除されている
```

- `PartDimensions.input` は残すが、第1.1版では `finished` と同じ値になる（逃げを引く処理がなくなるため）
- 初期値（`defaults.ts`）— 決定（planner）
  - `defaultNige()`：毎回新しい配列 `[{ id: 'nige-0.5', value: 0.5 }, { id: 'nige-1', value: 1 }]`。id は仕事の中で重複しなければよいので固定の文字列にする。あとから足す逃げの id は `newId('nige')`
  - `defaultBoards(newId)`：メラミン 1、ラワン 2.5、ラワン 4、ラワン 5.5（すべて 4×8 1220×2440、木目 長手方向。仕様書 5.1）。id は `newId('board')`。新しい仕事（`createJob`）はこれをそのまま使う
  - `nigeName(value)` → `逃げ0.5mm`・`逃げ1mm`（数値は小数第1位まで、末尾の .0 は付けない）
  - `boardTokenLabel(board)` → `ラワン4mm`（材料名＋厚み＋mm、間に空白なし。仕様書 5.4 の例に合わせる）
- 見本（本棚 W900）：板は今のまま2つ（シナランバー 18・シナベニヤ 4）、逃げは `defaultNige()`。棚板は `clearance: { W: 1 }` をやめて **W = `天地板.W - {n:nige-1}`**（表示は `天地板.W − 逃げ1mm`）。仕上がり 863 は変わらない — 決定（planner）

### 6.3 式から材料の厚み・逃げを参照する書き方 — 決定（planner）

**方針：式の文字列の中に id で書き、画面では名前に置き換えて見せる。**

材料は「材料名＋厚み」、逃げは「逃げ＋寸法」で名前が決まるので、名前で書くと厚みや逃げの寸法を変えたとたんに式が別の名前を指して壊れる。そこで式には変わらない id を入れる。

| 参照するもの | 式に保存する文字 | 画面の表示 | 値 |
|---|---|---|---|
| 部材の寸法（今のまま） | `全体.W` | `全体.W` | その部材の仕上がり寸法 |
| 材料の厚み | `{t:板のid}` | `ラワン4mm` | `board.thickness` |
| 逃げ | `{n:逃げのid}` | `逃げ1mm` | `nige.value` |

- 例：保存 `全体.W - 側板.W * 2 - {t:board-abc} * 2` → 表示 `全体.W − 側板.W × 2 − ラワン4mm × 2`
- 部材の参照は今のまま名前で書く（仕様書 6 の `部材名.W`。名前を変えたときのつけ替え `renamePart` もそのまま）
- 材料の厚み・逃げの寸法を変えても id は同じなので、式はそのままで値がついてくる。材料名を変えても同じ

**字句（`tokenize.ts`）**
- `splitChunks`：`{` から次の `}` までを1つのかたまりにする（中に記号や空白があっても区切らない）。`}` が無ければ式の終わりまでを1つのかたまりにし、字句のエラーにする
- かたまりが `{t:ID}` なら `{ type: 'thickness', boardId: ID }`、`{n:ID}` なら `{ type: 'nige', nigeId: ID }`。それ以外の `{…}` は字句のエラー（「読めない参照があります」）
- 全角の `｛ ｝` は NFKC で `{ }` になるので同じに扱う
- `validatePartName`：`{` `}`（全角も）を部材名に使えない文字に加える
- `renameRefsInExpr`：`{…}` のかたまりは部材の参照として読まない（書き換えない）

**構文木と計算（`parse.ts`・`evaluate.ts`）**
- 構文木に `{ type: 'thickness'; boardId }`・`{ type: 'nige'; nigeId }` を足す。どちらも数値と同じ位置に書ける
- `evaluate(ast, lookup)` の lookup を関数1つから次の形に広げる
  ```ts
  export interface Lookup {
    ref(part: string, axis: Axis): number | null   // 部材の仕上がり寸法。無ければ null
    thickness(boardId: string): number | null       // 材料の厚み。材料が無ければ null
    nige(nigeId: string): number | null             // 逃げの寸法。逃げが無ければ null
  }
  ```
- null のとき：厚み → `missingBoard`「削除した材料の厚みを使っています」、逃げ → `missingNige`「削除した逃げを使っています」
- 参照の依存関係（`resolve.ts`）には入れない（部材ではなく定数なので、循環は起きない）
- `computeDimensions(job)` は `job.boards` と `job.settings.nige` から値を渡す

**削除したとき** — 決定（planner）
- 材料・逃げを削除しても、式の中の `{t:…}` `{n:…}` はそのまま残し、その寸法をエラー（`missingBoard`／`missingNige`）にする。数値に置き換えて黙って計算を続けることはしない（どこを直せばよいか分かるように）
- 表示は `（削除した材料）`・`（削除した逃げ）` にし、1つの塊として消せる
- 削除する前に、使っている部材を示して確認する（仕様書 4・5.1）。一覧は `usages.ts` の関数で作る
  - `partsUsingNige(job, nigeId)`：式に `{n:id}` がある部材名と軸（例：`棚板（W）`）
  - `partsUsingBoardThickness(job, boardId)`：式に `{t:id}` がある部材名と軸
  - `partsUsingNiges(job, nigeIds)`・`partsUsingBoardThicknesses(job, boardIds)`：まとめて削除する前の確認用。id のどれかを使っている部材を部材ごとに1つ（軸はまとめる）
  - 材料の削除の確認には、`partsUsingBoard`（その材料から切る部材）と `partsUsingBoardThickness` の両方を出す

**仕事のコピー**：`copyJob` は板の id を新しくするので、式の `{t:古いid}` を `{t:新しいid}` につけ替える（`remapBoardIds(expr, map)`）。逃げの id は設定ごとそのまま写すので、つけ替えない

**カーソルで動く単位（`units.ts`）**
- `formulaUnits(expr): Unit[]`。単位は `{ kind, start, end }`（`start`・`end` は保存した文字列の位置）
  - `kind`：`digit`（数字1文字・小数点1文字ずつ）/ `op`（`+ - * /`）/ `paren` / `partRef`（`全体.W`）/ `thickness` / `nige` / `bad`（読めない文字のかたまり。古いデータ用）
  - 空白は単位にしない
  - 部材の参照・材料の厚み・逃げは1つの単位（仕様書 5.4「1つの塊として移動・削除する」）
- 画面のカーソルは **単位の番号**（0〜単位の数。k は「k 番目の単位の前」）で持つ
- `display.ts` の `unitLabel(unit, job)`：`*` → `×`、`/` → `÷`、`-` → `−`、`{t:…}` → `ラワン4mm`、`{n:…}` → `逃げ1mm`、見つからなければ `（削除した材料）`／`（削除した逃げ）`

### 6.4 仕上がり寸法の計算の単純化（`finished.ts`）

- 逃げは式の中で引くので、**仕上がり寸法 = 式の計算結果**（仕様書 7）
- 3.2 の手順 3・4 にある「面の2軸だけ逃げを引く」「自分の逃げを引く前の値で厚みを判定する」「厚みの判定を通った循環」はすべて不要になる。厚みの判定は仕上がり寸法で行う
- `thicknessInput`・`AbortThickness` などの仕組みは削除してよい

### 6.5 以前の版のデータの移し替え（`migrate/clearance.ts`）— 決定（planner）

仕様書 10：以前の版で部材ごとに入れていた逃げは、設定の逃げへ移し、その部材の式から引く形に書き換える。

`migrateClearanceChecked(job: LegacyJob, makeId: () => string): { job: Job; changed: { partId; name }[] }`、仕事だけ欲しいときは `migrateClearance(job, makeId): Job`（`LegacyJob` は `clearance` を持つ古い形。この関数の中だけで使う。engine は store の `newId` を import しないので、id の作り方は引数で受け取る）
1. 設定に `nige` が無ければ `defaultNige()` を入れる
2. 各部材の逃げのうち値が 0 より大きい軸について、同じ値の逃げが設定に無ければ足す（id は `makeId()`、値の小さい順に足す）。**値は丸めない**（0.25 は 0.25 のまま、名前は「逃げ0.25mm」）。同じ値かどうかは浮動小数の誤差（1e-9）だけ見のがして比べる（3 と 3.04、0.25 と 0.3 は別の逃げ）
3. どの軸に引くか：以前の計算と同じく **厚みの寸法の軸には引かない**。厚みの軸は `migrate/v1Dimensions.ts` の `computeV1Dimensions`（以前の版の `dimensions/finished.ts` をそのまま残したもの）で求める。以前の版は、厚みの自動判定をその部材自身の逃げを引く前の値で、ほかの部材の値は逃げを引いた後の値で行っていたので、逃げをすべて外した仕事では同じ軸にならないことがある。決まらなければ3軸とも引く＝以前と同じ
4. 式の書き換え：式が数値1つか部材の参照1つなら `元の式 - {n:id}`、それ以外は `(元の式) - {n:id}`。元の式が空ならそのまま（エラーのまま）
5. 書き換えた後の自動判定で厚みの軸が以前と変わる部材（例：材料 18・W `19`・H 600・D `18`・逃げ W1 → 今は W が 18 になり W が選ばれる）は、以前の軸を手で選んだことにする（`thicknessAxis` に入れる）
6. 確かめ：以前の計算と書き換えた後の計算で、部材ごとに仕上がり寸法・厚みの軸・木取り寸法を比べ、違う部材を `changed` に入れる（部材はそのまま残す）。ただし、以前は厚みが決まらず木取り寸法が出なかった部材が、仕上がり寸法は同じまま今は厚みが決まるときは、良くなっただけなので入れない
7. `memo: ''`、`checks: { finished: false, cut: false }` を足す
- 同じ仕事を2回移し替えても結果が変わらない（`clearance` が無い部材は何もしない）

### 6.6 保存データ第2版（`storage.ts`）— 決定（planner）

- 新しいキー `kidori.jobs.v2` に `{ version: 2, jobs: Job[] }` で書く。`kidori.currentJobId` はそのまま
- 読み込み
  1. `kidori.jobs.v2` があればそれを読む（第2版の形で検査・修復）
  2. 無くて `kidori.jobs.v1`（version 1）があれば、第1版の形で検査・修復したあと `migrateClearanceChecked` で移し替える。結果は次の保存で v2 に書く
  - 移し替えで寸法が変わった部材（`changed`）があれば、読み込みの知らせ（`LoadResult` の `message`。`ok` でも付く）に「以前の版から移したときに寸法が変わった部材：{仕事名}の {部材名・…}（寸法表で確かめてください）」を出す。画面では `loadError` と同じ帯に出す。保存は続ける
  3. **`kidori.jobs.v1` は消さず、書き換えもしない**（移し替えがうまくいかなかったときの控え）
- 第2版の検査・修復で足すもの
  - `settings.nige`：配列でなければ `defaultNige()`。id が空・重複、値が 0 以下・数でない、値が前の逃げと同じ（丸めずに比べる。移し替えで足した 0.25 と 0.3 を両方残すため）、のものは外す（外したら直した数に数える）
  - `part.memo`：文字列でなければ `''`
  - `part.checks`：`finished`・`cut` が真偽値でなければ false
  - `part.clearance` が残っていても読み捨てずに、`migrateClearance` を通す（v2 に古い形が混ざっても値が変わらないように）
- 退避のキーは第2版用に `kidori.jobs.v2.broken…` を使う

### 6.7 材料を減らせるときのお知らせ（`hints/saving.ts`）— 決定（オーナー）

`findSavingHints(job): SavingHint[]`（仕様書 9、未決事項 19）。試す値を変える引数はない
- **試す値**（`smallerSteps(current)`）：今の値より小さい整数を大きい値から 1mm まで（1mm 刻み）、最後に 0.5mm。**0mm は試さない**。今の値が小数なら切り捨てた値から（7.5 → 7, 6, …, 1, 0.5）。今の値が 0.5 以下なら何も試さない
  - 例：切り代 10 → 9, 8, …, 1, 0.5。端切り 5 → 4, 3, 2, 1, 0.5
- **切り代を優先**：まず切り代（仕事の切り代だけ。部材ごとの上書き（例：背板 0）はそのまま）を試す。**切り代でどの値でも減らなかった材料だけ**、端切りを試す
- 切り代と端切りを同時に変える組み合わせは試さない。切り方・刃厚は今の設定のまま（おまかせならおまかせで）

各値で `computeDimensions` → `packJob` をやり直し、材料ごとに必要枚数を今と比べる
- 必要枚数が減り、かつ入らない部材が増えない材料を「減る」とする
- 大きい値から試し、**まだお知らせに出していない材料が減った値**でお知らせを1つ出す（＝材料ごとに、減る一番大きい値で知らせる）
  - 切り代のお知らせには、その値で減る材料をすべて入れる（先に出した材料も、その値で減るなら入れる）
  - 端切りのお知らせには、切り代で減らなかった材料だけを入れる
- 並び：切り代（大きい値から）→ 端切り（大きい値から）
- 計算の回数：最大で 1 +（切り代の試す数）+（端切りの試す数）回（切り代10・端切り5 なら 16 回）。2枚以上使う材料がすべてお知らせに出たら、そこで打ち切る。今の計算で2枚以上使う材料が無ければ、計算し直さない。部材150枚・おまかせで数十ms

```ts
export interface SavingHint {
  change: { kind: 'allowance' | 'trim'; value: number }
  materials: { boardId: string; label: string; from: number; to: number }[] // label は「ラワン 4mm」
  message: string
}
```

- 文言：`切り代を 7mm にすると、ラワン 4mm が 1 枚減ります（3枚 → 2枚）`。材料が複数なら `、` でつなぐ：`切り代を 3mm にすると、シナランバー 18mm が 1 枚（3枚 → 2枚）、ラワン 4mm が 1 枚（2枚 → 1枚）減ります`
- 設定は自動で変えない（仕様書 9）。画面は知らせるだけ
- 画面側は `useMemo` で部材・設定が変わったときだけ計算する

### 6.8 画面の変更 — 決定（planner）

| 画面 | 変更 |
|---|---|
| 仕事 | 新しい仕事には初期の材料4つ・逃げ2つが入っている（`createJob`） |
| 部材の編集 | 逃げの欄をなくす。メモ（複数行の文字入力、ふつうのキーボード）を足す |
| 式の入力 | **`<input>` を使わず、式を表示する枠（`div`）にする**ので、押してもキーボードが出ない。枠を押すと末尾にカーソル。ボタン：部材の寸法・材料の厚み（登録順）・逃げ（登録順）・数字・小数点・`+ − × ÷ ( )`・◀ ▶（カーソル移動）・1字消す・全部消す。参照・厚み・逃げは色つきの塊で表示する。エラーは今のまま欄の下 |
| 寸法表 | メモを表示。部材ごとに「仕上がり 済」「木取り 済」のチェック（押せる大きさ 44px 以上）。チェックした段の数字はグレーにする（色だけでなく「済」の文字も出す）。部材の寸法を変えてもチェックは外さない |
| 木取り | 材料の一覧の上に、お知らせ（`SavingHint.message`）を出す。無ければ何も出さない |
| 設定 | 逃げの一覧（`逃げ0.5mm` など）。追加：寸法を入れるだけ（同じ寸法は登録できない）。寸法の変更（同じく重複不可。式の値もついてくる）。削除：式で使っていれば部材名と軸を示して確認。材料の削除の確認に、式で厚みを使っている部材も出す |

- ◀ ▶ と 1字消す は、部材の参照・厚み・逃げを1つの塊として扱う（`formulaEdit.ts`：`moveLeft`・`moveRight`・`insertAt`・`deleteBefore`・`clearAll`。すべてカーソル＝単位の番号で受け渡す）
- 挿入するときは、今と同じく前後に空白をはさんで読みやすくする（保存する文字列の空白は計算に影響しない）

## 7. 第1.2版の変更（iPhone での2回目の要望）

1〜6章と食い違うところは 7章が正。

### 7.1 お知らせの切り代（`hints/saving.ts`）— 調査の結果

- 「切り代が考えられていない」「切り代を 0 から 5 に変えてもお知らせが変わらない」を engine の側で確かめた。`findSavingHints` は渡された仕事の `settings.allowance` から試す値を作り、前の結果を覚えていない（キャッシュなし）。部材ごとの切り代が空欄（`null`）なら仕事の切り代を使い、入力があればその部材は変わらない（仕様どおり）。縦切り・横切り・おまかせ、複数の材料でも同じ（E-26 のテスト）
- 切り代 0 のときは切り代を試さない（0 より小さい値が無い）ので、お知らせは端切りだけになる
- 画面側は、仕事（設定を含む）が変わるたびに計算し直すこと（`useMemo` の依存に設定の変更が入っていること）

### 7.2 逃げ・材料の厚みの表示名

- `nigeName(value)`：`逃げ1`・`逃げ0.5`・`逃げ0.25`（「mm」を付けない）
- `boardTokenLabel(board)`（式のボタン・式の表示。`unitLabel`・`formulaLabels` もこれを使う）：`ラワン4`・`ラワン2.5`
- お知らせの文（`ラワン 4mm が 1 枚減ります`）と `boardLabel`（store）は変えない

### 7.3 厚みの寸法の不一致はエラー（`dimensions/thickness.ts`・`dimensions/validate.ts`）

- `DimensionErrorKind` に `thicknessMismatch` を足す。`computeDimensions` は、枚数1以上で材料のある部材の厚みの寸法が材料の厚みと合わない（小数第1位で比較）とき、その部材の `errors` にこのエラーを足す。`thicknessMismatch: boolean` も今までどおり付ける
  - 厚みの寸法を手で選んだ（または自動で決めた）とき：その軸に「厚みの寸法（W=19）が材料の厚み 18 と合いません」
  - 自動で見つからないとき（3軸とも計算できたとき）：材料の厚みに一番近い値の軸（同じなら W→H→D）に「材料の厚み 18 と同じ寸法がありません（W=19・H=700・D=600）。寸法を直すか、厚みの寸法を選んでください」
  - 計算できない軸があるときは、今までどおり不一致と決めない（式のエラーだけ出る）
  - 仕上がり寸法は計算できているので、その部材を参照するほかの部材のエラーにはしない（`from` は付けない）。木取り寸法も、手で軸を選んでいれば今までどおり出す
- 木取り計算では `skipped` の理由 `thicknessMismatch`（「厚みの寸法が材料の厚みと合わない」）で除く。式のエラーもあれば `dimensionError` を優先する。`noThickness` は出なくなる（型は残す）
- `validatePartForSave(job, part): string[]`：編集中の部材を仕事に当てはめて計算し、`thicknessMismatch` のメッセージだけを返す（空なら保存してよい）。式のエラーは保存を止めない（以前のまま）

### 7.4 材料の並び順（`boards.ts`）

- `Board.builtIn?: true`：新しい仕事に最初から入っている材料の印。`defaultBoards` が付け、あとから足した材料（`newBoard`・`addBoard`）には付けない。材料を編集しても印は残る（`updateBoard` は元の板に上書きするため）。保存（`storage.ts` の `sanitizeBoard`）は印があれば残す
- 保存の並び（`job.boards`）＝追加した順のまま変えない。並べ替えは表示のときだけ行う
- `orderedBoards(job): Board[]`：足した材料（保存の並び）→ 最初から入っている材料（保存の並び）の新しい配列。部材の編集の材料の選択・式の材料の厚みボタン・設定の材料の一覧で使う
- `isBuiltInBoard(board, job)`：
  - 印があれば最初からある材料
  - 仕事の中に印のある材料が1つでもあれば（第1.2版以降に作った仕事）、印の無い材料は足した材料
  - 印がひとつも無い仕事（第1.1版までに作った仕事）では、最初からある4つ（`defaultBoards`）と材料名・厚み・大きさの種類・短辺・長辺・木目がすべて同じ材料を最初からある材料とみなす。保存データは書き換えない（読むたびに判定する）
  - 割り切り：第1.2版以降の仕事で最初からある4つをすべて消したあと、同じ内容の材料を足し直すと、その材料は「最初からある材料」とみなされて下に並ぶ
- 木取りの結果（`packJob` の材料の並び）や お知らせの並びは、今までどおり保存の並び（変えない）

## 8. 第1.3版の変更（iPhone での3回目の要望）

仕様書 4（設定の引き継ぎ・設定画面の一覧）・5.1・5.4・8・9（材料のサイズの選択）の変更に対応する。1〜7章と食い違うところは 8章が正。
方針は「データの形はなるべく変えない」。保存データ（`kidori.jobs.v2`）の形は変えず、版も上げない（8.2）。

### 8.1 追加・変更するファイル

```
src/engine/
  types.ts               PackingResult.done を足す
  defaults.ts            DEFAULT_SHEET（4×8）・defaultSheet()
  boards.ts              isBuiltInBoard の以前のデータの判定を「材料名＋厚み」だけにする
  packing/pieces.ts      木取り済み（checks.cut）の部材を除き、done に入れる
  packing/sizes.ts       compareStandardSizes：材料ごとに 3×6 と 4×8 で木取りした枚数・歩留まり
src/store/
  template.ts            最後に使った設定（ひな形）：templateOf・defaultTemplate・sameTemplate
  sample.ts              sampleFromTemplate（見本の仕事をひな形の設定で作る）
  jobs.ts                createJob(name, template)、newBoard の初期サイズ 4×8、setBoardSize、removeNiges・removeBoards
  storage.ts             ひな形の読み書き（キー kidori.lastSettings.v1）
  reducer.ts / JobStore.tsx  StoreState.template、設定が変わったらひな形を更新して保存
src/ui/
  components/SettingsList.tsx  逃げ・材料の共通の一覧（名前・編集・削除、上に追加、一括削除）
  components/SheetSizePicker.tsx  木取りの画面の材料のサイズの選択
  components/BoardEditor.tsx   材料名・厚みだけにする（サイズ・木目の欄を外す）
  components/FormulaInput.tsx  厚みのボタンは選んだ材料だけ
  screens/KidoriScreen.tsx     サイズの選択・木取り済みの部材の一覧
  screens/JobsScreen.tsx       新しい仕事・見本をひな形から作る（見本は何度でも追加できる）
```

### 8.2 材料のサイズを持つ場所 — 決定（planner）

- **サイズは今までどおり `Board` の `sizeKind`・`width`・`length`・`grain` に持つ。** 材料は仕事ごとなので、`job.boards` の各材料のサイズが「この仕事で、この材料に選んだサイズ」になる（仕様書 9「選んだサイズは仕事に保存する」）
  - 別の表（`Job.sheetSizes` など）を作らないのは、材料の削除・仕事のコピー（id のつけ替え）・保存の検査でずれが起きないようにするため。`copyJob`・`removeBoards`・`sanitizeBoard` は今のまま使える
  - 以前のデータのサイズ（例：見本の 3×6、以前の材料の 4×8、自由入力）は、そのまま「その仕事で選んだサイズ」になる。**保存データの移し替えは要らず、`kidori.jobs.v2` の版も上げない**（形が変わらないので、上げると壊す危険だけが増える）
- 「材料＝材料名＋厚み」は画面と引き継ぎの側で守る
  - 設定の画面（`BoardEditor`）は材料名と厚みだけを入れる。サイズと木目の方向は木取りの画面（`SheetSizePicker`）で選ぶ
  - 新しく足す材料のサイズは 4×8（`defaultSheet()`：`shihachi`・1220×2440・`grain: 'long'`）。`newBoard` の初期値を 3×6 から 4×8 に変える
  - 最後に使った設定（8.3）には材料名・厚みだけを入れ、サイズは入れない。新しい仕事の材料は 4×8 から始まる
- サイズを選ぶ操作：`setBoardSize(job, boardId, size: { sizeKind; width; length; grain })`（中身は `updateBoard` と同じ検査。3×6・4×8 は寸法が決まり木目は長手方向）
- `isBuiltInBoard` の、印の無い以前のデータの判定（7.4）は **材料名＋厚みだけ** で比べる（サイズを木取りの画面で変えても、最初からある材料のまま下に並ぶように）

### 8.3 最後に使った設定（ひな形）— 決定（planner）

仕様書 4「設定の引き継ぎ」。仕事ごとの設定はそのまま持ち、アプリ全体で「最後に使った設定」を1つだけ別に覚える。

```ts
// src/store/template.ts
export interface MaterialSpec {
  material: string
  thickness: number
  builtIn?: true      // 最初から入っている材料の印（並び順のため。7.4）
}
export interface SettingsTemplate {
  settings: Settings  // 刃厚・端切り・切り代・切り方・逃げ（id ごと）
  materials: MaterialSpec[] // 保存の並び（job.boards の並び）
}
```

- `defaultTemplate()`：`defaultSettings()`（刃厚3・端切り5・切り代10・縦切り優先・逃げ0.5・1）と、材料 メラミン1・ラワン2.5・4・5.5（すべて `builtIn: true`）。仕様書 4 の「初めて使うとき」
- `templateOf(job)`：仕事の設定と材料（材料名・厚み・印）を写したもの（深いコピー）。印は `isBuiltInBoard(board, job)` で決めて付ける（印の無い以前の仕事でも並び順が保たれる）。サイズは入れない
- `sameTemplate(a, b)`：中身が同じか（JSON で比べてよい）
- `createJob(name, template = defaultTemplate(), now, id)`：設定は `template.settings` の深いコピー（逃げの id もそのまま。`copyJob` と同じ）、材料は `template.materials` を並びのまま、id を `newId('board')`、サイズは `defaultSheet()` にして作る
- **ひな形を更新するとき**：reducer の `applyOp` で、操作の前後で `templateOf` が変わったら（`!sameTemplate`）、`state.template = templateOf(後の仕事)` にする。操作の種類で分けないので、刃厚・端切り・切り代・切り方・逃げの追加／変更／削除・材料の追加／変更／削除のどれでも漏れない。サイズの選択・部材の変更・仕事の名前の変更では `templateOf` が変わらないので更新しない
  - 仕事の追加（新しい仕事・見本・コピー）と仕事の削除ではひな形を変えない（見本が足した材料は「設定を変えた」ではないため）
- 一度写したあとは、仕事とひな形は別のデータ（深いコピー）。ひな形が変わっても、ほかの仕事は変わらない

**保存（`storage.ts`）**
- キー `kidori.lastSettings.v1` に `{ version: 1, template }`。仕事の保存と同じく 300ms まとめて書く（`JobStore` の保存の effect に入れる）。`canSave` が false のときは書かない
- 読み込み：`loadTemplate(storage, jobs): SettingsTemplate`。例外は投げない
  1. キーがあり読めれば、それを検査・修復して使う（設定は `sanitizeSettings` と同じ検査、材料は材料名が空・厚みが 0 以下・材料名＋厚みの重複を外す）
  2. キーが無いとき：仕事が1つもなければ `defaultTemplate()`。仕事があれば（第1.2版から上げたとき）**更新日が一番新しい仕事の `templateOf`**（暫定。未決事項 23）
  3. 読めない（壊れた JSON など）ときは `defaultTemplate()` にする。退避はしない（仕事のデータではなく、次に設定を変えれば上書きされるため）

### 8.4 見本（本棚 W900）をひな形から作る — 決定（planner。第1.6版で変更）

`sampleFromTemplate(template, now): Job`（`src/store/sample.ts`）。`bookshelfJob()`（engine の見本。以前のテストで使う）は変えない。
1. `createJob('本棚 W900', template, now)` で作る。**第1.6版から id は追加するたびに新しくし、見本があっても「見本を追加」を出す**（以前は id を固定して見本が1つあるとボタンを隠していたため、古い設定の見本が残り「今の設定が見本に出ない」ことになっていた）
2. ひな形の材料・調整寸法・フラッシュ・数値の設定はそのまま使い、見本で使うものが無ければ足す：材料 シナランバー 18・シナベニヤ 4（同じ材料名（NFKC）＋厚み（`eq1`）があればそれを使う）、フラッシュ「フラッシュ25」（同じ名前があればその中身のまま使う。無ければ 芯材15・メラミン1×2・ラワン4×2 で足し、メラミン1・ラワン4 も無ければ足す）、逃げ1（名前「逃げ」寸法 1。無ければ足す）
3. 部材：全体 900×1800×400（枚数0）／側板 W`{t:ランバー}` H`全体.H` D`全体.D` ×2 木目H／天地板 フラッシュ25 W`全体.W - 側板.W * 2` H`{t:フラッシュ25}` D`全体.D` ×2 木目W／棚板 W`天地板.W - {n:逃げ1}` H`{t:ランバー}` D`全体.D - 20` ×4 木目W／背板 シナベニヤ4 W`全体.W` H`全体.H` D`{t:ベニヤ}` ×1 木目H 切り代0
4. 見本で使う材料のサイズは **3×6（サブロク）**（未決事項 24）。すでにあった材料を使うときも、この仕事の中ではその材料を 3×6 にする
- 見本で期待する値（ひな形が初期値のとき）は tasks.md の S-12

### 8.5 木取り済みの部材を除く（`packing/pieces.ts`）— 決定（planner）

仕様書 8：寸法表で木取りの「完了」（`part.checks.cut`）をチェックした部材は、木取りの計算から除く。

```ts
export interface PackingResult {
  materials: MaterialResult[]
  totalYieldRate: number
  skipped: …（今のまま）
  /** 木取り済み（checks.cut）で計算から除いた部材（部材の並び順。枚数0の行は含めない） */
  done: { partId: string; name: string; quantity: number; boardId: string | null }[]
}
```

- `expandPieces` で、枚数1以上の部材のうち `checks.cut === true` のものは **ほかの判定より先に** `done` に入れて片にしない（材料が無い・寸法のエラーがあっても `skipped` には入れない。除いているので、直さなくても木取りに影響しないため）
- 仕上がりの「完了」（`checks.finished`）は木取りに関係しない
- お知らせ（`findSavingHints`）とサイズの比較（8.6）は `packJob` を使うので、木取り済みの部材は自然に除かれる
- 部材がすべて木取り済みなら `materials` は空

### 8.6 材料のサイズの比較（`packing/sizes.ts`）— 決定（planner）

仕様書 9「材料のサイズの選択」：材料ごとに 3×6 と 4×8 の両方で木取りし、必要な枚数と歩留まりを並べる。

```ts
export type StandardSize = 'saburoku' | 'shihachi'
export interface SizeSummary {
  kind: StandardSize
  width: number; length: number
  sheetCount: number
  yieldRate: number        // その材料の歩留まり
  unplacedCount: number    // 入らない部材の数
}
export interface MaterialSizeComparison {
  boardId: string
  options: [SizeSummary, SizeSummary] // 3×6、4×8 の順
  fewer: StandardSize | null           // 枚数が少ない方
  higher: StandardSize | null          // 歩留まりが高い方
}
export function compareStandardSizes(job: Job, dims: DimensionResult): MaterialSizeComparison[]
export function pickBetterSize(options: [SizeSummary, SizeSummary]): { fewer; higher }
```

- `fewer`・`higher`（画面の「枚数が少ない」「歩留まりが高い」の印）：入らない部材が出るサイズ・枚数 0 のサイズがあれば比べず、どちらも null。枚数が同じなら `fewer` は null。歩留まりは % の小数第1位で比べ、同じなら `higher` は null。画面は判定せず、この結果を出すだけ

- 作り方：仕事の材料をすべて 3×6（木目 長手方向）にした仕事と、すべて 4×8 にした仕事を作り、それぞれ `packJob` を1回ずつ呼ぶ（**材料の数によらず `packJob` 2回**）。材料ごとの結果を `boardId` で拾う。元の仕事は書き換えない
- 並びと対象：`packJob(job, dims).materials` と同じ材料・同じ並び（片か入らない部材のある材料だけ。部材の無い材料は出さない）（暫定。未決事項 26）
- 切り方・刃厚・端切り・切り代は今の設定のまま（おまかせならおまかせで比べる）
- 自由入力は比べない。自由入力を選んでいるときは、画面は今の結果（`packJob`）の枚数・歩留まりを自由入力の欄に出す
- 速さ：画面で1回の変更につき 今の結果1回 ＋ 比較2回 ＋ お知らせ（最大16回）。部材150枚・おまかせで比較だけで 1秒以内（テストで確かめる）。お知らせの中では比較をしない

### 8.7 画面の変更 — 決定（planner）

| 画面 | 変更 |
|---|---|
| 仕事 | 新しい仕事は `createJob(name, state.template)`、見本は `sampleFromTemplate(state.template)` で作る |
| 設定 | 説明に「新しい仕事には、最後に変えた設定が引き継がれます」を足す。逃げと材料は `SettingsList` で同じ見た目・操作にする（8.8）。材料の編集は材料名と厚みだけ |
| 部材の編集（式の入力） | 材料の厚みのボタンは、その部材で選んでいる材料（編集中の下書きの `boardId`）の1つだけ。材料を選んでいなければ厚みのボタンは出さない。式の中にほかの材料の厚みがあっても、表示と計算は今のまま |
| 木取り | 材料ごとに、サイズの選択（3×6・4×8 の枚数と歩留まりを並べ、押して選ぶ。自由入力を選ぶと短辺・長辺・木目の方向の欄）。選ぶと `setBoardSize` で仕事に保存する。「木取り済み（計算から除いています）」の一覧（部材名・材料・枚数）を、計算できない部材の一覧と分けて出す |

### 8.8 設定の一覧（逃げ・材料）の共通部品 — 決定（planner）

`SettingsList<T>`（`src/ui/components/SettingsList.tsx`）
- 上に追加の入力（逃げ：寸法だけ。材料：材料名と厚み。厚みは空欄から始め、入れないと追加できない＝U-26 のまま）
- その下に1行ずつ：名前（逃げ1／シナランバー 18mm）と「使っている部材」、「編集」「削除」のボタン（高さ 44px 以上）
  - 編集：その行がその場で編集の形になる（逃げは寸法、材料は材料名・厚み）
  - 削除：その行がその場で確認の形になる。使っている部材があれば部材名を示す（逃げ：`nigeUsages`・`nigesUsages`、材料：`boardsUsages`。1つだけ消すときも `removeNiges`・`removeBoards` に id 1つで渡す）
- 「選んで削除」ボタンで選ぶモードにする。各行にチェック（44px 以上）、「選んだ◯件を削除」「やめる」。押すと、選んだものを使っている部材をまとめて示して確認し、`removeNiges(job, ids)`／`removeBoards(job, ids)` で1回の操作で消す（1回の保存・1回のひな形の更新）
- 部品は「行の中身・追加の入力・編集の入力」を受け取るだけにし、逃げ・材料の操作（store の関数）は呼ぶ側で渡す

### 8.9 逃げの削除が効かない不具合（調査の見立て）

オーナーの報告：設定で、追加した逃げの「削除」を押しても消えない。
- コードを読んだ範囲では、`removeNige`（store/jobs.ts）・reducer の `applyOp`・`NigeEditor` の「削除 → 確認 → 削除する」の流れに、消えない理由になる誤りは見つからなかった。初期の逃げ（id `nige-0.5`・`nige-1`）と足した逃げ（id `nige-<uuid>`）で処理は同じ
- 見立て（確かめる順）
  1. **確認が目に入っていない**：「削除」は すぐ消さず、その行を同じ場所で確認の形（同じ名前が出る）に替えるだけ。足した直後は追加の欄に注目が残り iPhone のキーボードが出たままなので、「削除」を押すとキーボードが閉じて画面が動き、確認の形が画面の外に出たり、何も変わらないように見える。キーボードが閉じるときの最初のひと押しが「削除」に届いていないこともありうる
  2. 追加の欄が画面の下にあり、確認の形の「削除する」がキーボードの陰に隠れる
  3. 上の2つでなければ、保存の側（再読み込みで戻る）を疑う：`canSave` が false（保存を止めている）で、消しても再読み込みで元に戻っている
- 直し方の方針：開発サーバー（幅375px）と iPhone で再現してから直す。追加したら追加の欄の注目を外す（キーボードを閉じる）、確認の形を見える位置へスクロールし見た目をはっきり変える。store の側にも「足した逃げを消すと一覧から消え、保存して読み込んでも戻らない」テストを足す。第1.3版の共通の一覧（8.8）でも同じ直し方を使う

## 9. 第1.4版の変更（調整寸法・厚みの自動表示・寸法表の内訳）

仕様書 4（調整寸法）・5.3・9（寸法表の表示の切り替え）に対応する。内部の名前（`Nige`・`settings.nige`・式の `{n:id}`）は変えない。

### 9.1 調整寸法（`Nige.name`）

- `Nige` に `name: string`（空でない）を足す。表示名は `nigeName(n)`＝名前＋寸法（逃げ1、ほぞ15。mm なし）。式の表示（`unitLabel`・`formulaLabels`）もこれを使う
- 同じものの判定は、名前（`nigeNameKey`：前後の空白を外し全角・半角をそろえる）と寸法の両方。`addNige(job, name, value, id?)`・`updateNige(job, id, name, value)`
- 保存データの版は上げない。`sanitizeNige` で、名前の無い項目（第1.3版まで）は名前「逃げ」にする（直した数に数えない）。名前が文字でない・空なら「逃げ」に直す（直した数に数える）
- 以前の版の部材ごとの逃げの移し替え・見本の 逃げ1 は、名前「逃げ」の項目だけを探し、無ければ名前「逃げ」で足す

### 9.2 寸法表の内訳（`dimensions/explain.ts`）

```ts
explainDimension(job, partId, axis, finished?): DimensionExplanation | null   // finished は computeFinished(job)（省略可）
explanationText(e): string   // 「全体.W 900 − 側板.W 18 × 2」（第1.9版から「= 結果」は付けない）
```

- 式を左から順に、記号・数・参照（部材の寸法・材料の厚み・調整寸法。表示名と値）の並びにして、計算結果と一緒に返す。例：天地板.W → 項 `全体.W 900 − 側板.W 18 × 2`、結果 864
- 値は `computeDimensions` と同じ計算（仕上がり寸法）。式や参照先にエラーがあれば `result` は null で、その寸法のエラーを返す。読めない式は項なし
- 文字にするとき、参照の後ろに値を出すのは部材の寸法（`全体.W 900`）だけ。調整寸法（`逃げ1`）・材料の厚み（`ラワン4`）は表示名に値が入っているので表示名だけ（例：`天地板.W 864 − 逃げ1`）。文字には項と値だけを出し、「= 結果」や「?」は付けない（結果は寸法表の数字で分かる）
- 表示の数：式に書いた数はそのまま、参照した部材の寸法は小数第1位まで

### 9.3 厚みの寸法の自動表示（`dimensions/thickness.ts`）

```ts
thicknessChoice(part, board, finished): { autoAxis; candidates; ambiguous; showSelector }
```

- `autoAxis`：自動で選ぶ軸（手で選んだ軸は見ない。W→H→D で材料の厚みと同じ最初の軸）。`candidates`：材料の厚みと同じ値の軸。`ambiguous`：候補が2つ以上
- `showSelector`：`ambiguous`、手で選んだ軸がある、厚みと同じ寸法が無い（不一致のエラーで「厚みの寸法を選んでください」と出るため）のどれか（暫定）。枚数0の行・材料が未設定なら false
- 画面は `showSelector` が false なら「厚み：W（自動）」と表示だけにする

## 10. 第1.5版の変更（フラッシュ 第1段階）

仕様書 4（フラッシュ）に対応する。保存データの版は上げない。

### 10.1 データの形 — 決定（進行役）

```ts
interface FlushFace { boardId: string; count: number }            // 表面材（登録済みの材料）と 1部材あたりの枚数（1以上の整数）
interface Flush { id: string; name: string; core: number; faces: FlushFace[] }
Job.flushes: Flush[]                 // 登録順＝画面の並び順
Part.flushId?: string                // 材料のかわりにフラッシュを選んだ部材。このとき boardId は null
PartChecks.cutByBoard?: Record<boardId, boolean>   // フラッシュの部材の、表面材ごとの木取りの完了
```

- フラッシュは材料（`boards`）の id を指すので、設定（`settings`）ではなく材料と同じ階層（`job.flushes`）に置く。画面では設定画面に出す
- 部材は `boardId` をそのまま残し、`flushId` を足す（無ければ今までどおり）。`addPart`・`updatePart` は `flushId` があれば `boardId` を null にそろえる
- 芯材の厚みは 0 より大きい。表面材は1つ以上・同じ材料を重ねない・枚数は1以上の整数。名前は空でなく、ほかのフラッシュと重ならない（前後の空白・全角半角をそろえて比べる）
- フラッシュの部材の `checks.cut` は使わない（完了は表面材ごとの `cutByBoard`）

### 10.2 厚み（`engine/flush.ts`）

```ts
flushThickness(flush, boards): number                   // 芯材＋Σ 表面材の厚み×枚数（見つからない材料は数えない）
thicknessOfId(job, id): number | null                    // 材料の厚み、またはフラッシュの合計の厚み
thicknessRefLabel(job, id): string | null                // 式の表示名：材料は ラワン4、フラッシュは名前（フラッシュ25）
partThicknessSource(job, part): { thickness } | null     // 部材の厚みの判定に使う厚み（材料またはフラッシュ）
flushBreakdown(job, flushId): FlushBreakdown | null      // 芯材・表面材ごと・合計
flushBreakdownText(b): string                            // 「芯材15 ＋ メラミン1×2 ＋ ラワン4×2 ＝ 25」
flushesUsingBoards(job, boardIds): string[]              // 材料を削除する前の確認用（フラッシュの名前）
partsUsingFlushes(job, flushIds): string[]               // その材料欄でフラッシュを選んでいる部材
```

- 式の厚みは、新しい書き方を作らず `{t:id}` のまま、id がフラッシュならその合計の厚みにする。表示名はフラッシュの名前。削除したフラッシュは、削除した材料と同じエラー（missingBoard）
- 厚みの判定（`computeDimensions`）・不一致のエラーは `partThicknessSource` の厚みを使う。画面の `thicknessChoice` にも同じものを渡す

### 10.3 木取り（`packing/pieces.ts`）

- フラッシュの部材は、表面材ごとに 表面材の枚数×部材の枚数 の片にし、その材料の板で木取りする。木取り寸法・木目は部材のまま、向きはそれぞれの材料の木目で決める。芯材は入れない
- 片の id は `${partId}#${連番}`。連番は表面材をまたいで続ける（メラミン1 が #1〜#4、ラワン4 が #5〜#8）
- `cutByBoard[boardId]` が true の表面材は、ほかの判定より先に除き、`done` に `{ partId, name, quantity: 枚数×部材の枚数, boardId: 表面材 }` で出す。残りの表面材があれば、そのうえで寸法のエラー・厚みの不一致を見る（部材ごとに1つ `skipped`）
- 表面材が1つも残っていない（材料を削除した）フラッシュの部材は `skipped` の `noBoard`

### 10.4 保存・引き継ぎ・コピー（`src/store`）

- 読み込み：`flushes` が無ければ `[]`（直した数に数えない）。読めないフラッシュ・無い材料の表面材は外す。無いフラッシュを指す部材は `flushId` を外す（直した数に数える）。`cutByBoard` は真偽値のものだけ残す
- ひな形：`SettingsTemplate.flushes?: FlushSpec[]`。表面材は材料の id ではなく「材料名＋厚み」で持ち、新しい仕事を作るときに同じ材料名＋厚みの材料の id に直す。見本も同じ（ひな形から作るため）
- 仕事のコピー：フラッシュの id・表面材の材料の id・部材の `flushId`・`cutByBoard` のキー・式の `{t:…}` をつけ替える
- 操作：`addFlush(job, draft, id?)`・`updateFlush(job, id, draft)`・`removeFlushes(job, ids)`（使っていた部材は材料が未設定になる）・`flushesUsages(job, ids)`（表面材ごとの完了を付ける `setFlushCutCheck` は第1.8版で削除。外すのは `clearLegacyCut`）。`removeBoards` は削除した材料をフラッシュの表面材から外し、`boardsUsages` は `flushes`（使っているフラッシュの名前）も返す

## 11. 第1.8版の変更（切りながら進める木取り）— 決定（planner）

仕様書 9（切る順番・加工のチェック）の変更（コミット 704291b）に対応する。1〜10章と食い違うところは 11章が正。
方針は「**固定した1枚は、そのとき画面に出ていた1枚をまるごと写して持つ**」。写しから描き、写しから進み具合を計算する。今の部材から作り直さないので、部材や設定が変わっても固定した1枚は動かない（仕様書 9「固定している1枚は…変わらない」）。

### 11.1 追加・変更するファイル

```
src/engine/
  types.ts                FrozenSheet・Job.frozenSheets を足す
  progress/
    frozen.ts             freezeSheet（写しを作る）・frozenDemand（固定した片の数）・frozenSheetViews（表示用・変わった部材の検出）・materialSummaries
    sheetProgress.ts      sheetProgress（済んだ工程・次の工程・残りの材料）
    sheetChecklist.ts     sheetChecklist（1枚ごとのチェックリストの行）
  packing/pieces.ts       固定した片の数を、部材ごとの枚数から引いてから片にする
  packing/index.ts        packJob が job.frozenSheets を見て引く（入口の形は変えない）
src/store/
  jobs.ts                 setPieceCheck（1枚ごとのチェック。最初のチェックで固定、全部外すと固定を外す）・clearLegacyCut・copyJob
  storage.ts              frozenSheets の検査・修復
src/ui/
  screens/KidoriScreen.tsx     材料ごとに 固定した1枚 → 計算した1枚 の順で、1枚ごとに 配置図・チェックリスト・切る順番
  components/SheetDiagram.tsx  チェックした部材をグレー、残りの材料の枠
  components/SheetChecklist.tsx 1枚ごとのチェックリスト（CutChecklist の置きかえ）
  components/CutSteps.tsx      切る順番（済んだ工程はグレー、次の工程を目立たせる）
```

### 11.2 データの形（`types.ts`）

```ts
/** 固定した1枚（第1.8版）。1つ目の部材にチェックしたときに、画面に出ていた1枚を写して作る */
export interface FrozenSheet {
  id: string                     // 仕事の中で重複しない（newId('sheet')）
  boardId: string                // 切っている材料（フラッシュの表面材なら表面材の材料）
  /** 固定したときの材料の表示（材料を削除・変更しても表示できるように） */
  material: string
  thickness: number
  grain: BoardGrain              // 固定したときの材料の木目の方向（配置図の木目の表示）
  mode: 'vertical' | 'horizontal' // 固定したときの切り方（おまかせなら選ばれたほう）
  kerf: number                   // 固定したときの刃厚（残りの材料の計算に使う）
  trim: number                   // 固定したときの端切り（凡例の表示）
  /** 固定したときの1枚（SheetLayout をそのまま写す。index は使わない＝表示のときに振り直す） */
  layout: SheetLayout
  /** チェックした片の pieceId（layout.placements の pieceId。重複なし・写しにあるものだけ） */
  checked: string[]
  frozenAt: string               // ISO
  /** すべての片にチェックした時刻。あれば「切り終わり」（木取り画面の通常の一覧に出さない） */
  completedAt?: string
}

export interface Job {
  …今のまま
  /** 固定した1枚（固定した順）。以前のデータは読み込むときに [] */
  frozenSheets: FrozenSheet[]
}
```

- 片の中身（部材・材料・寸法）は `layout.placements` の `partId`・`name`・`sizeLabel` と `FrozenSheet.boardId` で分かる。フラッシュの片は「部材 × その1枚の材料（表面材）」。別に表面材の id は持たない
- `pieceId`（`${partId}#${連番}`）はその1枚の中では重ならない（1つの材料の中で部材ごとの通し番号のため）。ほかの1枚・計算し直した1枚とは重なってよい。画面のキーは `${frozenSheet.id}:${pieceId}` や `計算した1枚の番号:${pieceId}` にする
- **切り終わった1枚は消さずに残す**（`completedAt` を付ける）。消すと、その片が「まだ切っていない」扱いになって計算に戻ってしまうため。画面の通常の一覧からは外す
- `completedAt` は `checked` から分かる値だが、切り終わった時刻を残すために持つ。`checked.length === placements.length` と食い違ったら読み込みで直す（11.8）
- 保存データ（`kidori.jobs.v2`）の版は上げない（足すだけ。無ければ `[]`）

### 11.3 固定した片を計算から除く（`progress/frozen.ts`・`packing/pieces.ts`）

```ts
/** 固定した1枚（切り終わりを含む）の片の数。キーは `${partId}|${boardId}` */
export function frozenDemand(job: Pick<Job, 'frozenSheets'>): Map<string, number>
```

- `expandPieces(job, dims)` で、部材（フラッシュは表面材ごと）の枚数から `frozenDemand` の数を引いてから片にする（0 未満にはしない）。**寸法ではなく数だけで引く**（固定した片の寸法が変わっていても引く。変わったことは 11.5 で知らせる）
- 片の id の連番は今までどおり 1 から振る（固定した片と同じ id になってよい。11.2）
- 引いた結果 片が 0 になった部材（表面材）は、`done`（以前の木取り済み）にも `skipped` にも入れない
- `packJob` の入口の形は変えない。`MaterialResult.sheets`・`sheetCount`・`yieldRate` は **固定していない片だけで計算した1枚** を表す
- そのため **お知らせ（`findSavingHints`）とサイズの比較（`compareStandardSizes`）は、固定していない片だけで計算する**（どちらも `packJob` を呼ぶので、何も足さなくてよい）。固定した1枚は切り代・端切り・材料のサイズを変えても変わらないので、比べる意味がないため
  - お知らせの「3枚 → 2枚」の数も、固定していない1枚の数になる（暫定。未決事項 30）

### 11.4 固定の作り方と外し方（`freezeSheet`・store の `setPieceCheck`）

```ts
// engine（純粋関数）
export function freezeSheet(
  job: Job, boardId: string, mode: 'vertical' | 'horizontal', layout: SheetLayout, id: string, now: Date,
): FrozenSheet   // material・thickness・grain は job.boards から、kerf・trim は job.settings から写す。layout は深いコピー

// store
export type SheetTarget =
  | { kind: 'frozen'; sheetId: string }
  | { kind: 'computed'; boardId: string; mode: 'vertical' | 'horizontal'; layout: SheetLayout }
export function setPieceCheck(job: Job, target: SheetTarget, pieceId: string, done: boolean, now?: Date, id?: string): OpResult
```

- **計算した1枚**（`computed`）にチェック：画面に出ている `layout` を `freezeSheet` で写し、`checked: [pieceId]` で `job.frozenSheets` の最後に足す。`done = false` は何もしない。`pieceId` が `layout` に無ければ失敗
- **固定した1枚**（`frozen`）：`checked` に足す／外す
  - すべての片にチェックが付いたら `completedAt = now`（切り終わり）。1つでも外したら `completedAt` を消す
  - **チェックがすべて外れたら、その1枚を `frozenSheets` から消す**（固定を外す。片は計算に戻り、今の部材で並べ直す。仕様書 9）
- 画面は `computed` の `layout` に、今表示している `MaterialResult.sheets[i]` をそのまま渡す（見ているものと写すものが同じになる）

### 11.5 表示用のまとめと、部材が変わったことの検出（`frozenSheetViews`）

```ts
export interface FrozenDrift {
  partId: string
  name: string                 // 今の部材名（部材が無ければ写しの名前）
  reason: 'size' | 'count' | 'removed'
}
export interface FrozenSheetView {
  sheet: FrozenSheet
  label: string                // 「ラワン 4mm」（材料があれば今の名前、無ければ写し）
  boardExists: boolean
  progress: SheetProgress      // 11.6
  drift: FrozenDrift[]         // 空なら変わっていない
  complete: boolean
}
export function frozenSheetViews(job: Job, dims: DimensionResult): FrozenSheetView[] // frozenSheets の並び
```

「部材が変わっています」（仕様書 9）の判定。片ごとに見て、部材ごとに1つにまとめる：
- `removed`：部材が無い、または部材がもうその材料から切らない（材料を変えた・フラッシュの表面材から外れた）
- `size`：今の木取り寸法の表示（面の2軸の順、`${round1(s0)}×${round1(s1)}`）が写しの `sizeLabel` と違う。寸法にエラーがあって今の寸法が出ないときも `size`
- `count`：その部材（表面材）について、**すべての固定した1枚（切り終わりを含む）の片の数 ＞ 今の枚数**（フラッシュは 表面材の枚数×部材の枚数）。枚数が増えたときは、増えた分が固定していない1枚に並ぶだけなので知らせない
- 木目・切り代だけの変更（寸法が同じ）は知らせない。固定は外さない
- 以前の「木取り済み」（`checks.cut`・`cutByBoard`）の部材も、枚数は部材の枚数のまま比べる

```ts
export interface MaterialSummary {
  boardId: string
  sheetCount: number     // 画面に出す材料の枚数 ＝ 固定した1枚（切り終わりを除く）＋ 計算した1枚
  yieldRate: number      // 同じ1枚たちの歩留まり
  completedCount: number // 切り終わった1枚の数
}
export function materialSummaries(job: Job, result: PackingResult, views: FrozenSheetView[]): { materials: MaterialSummary[]; totalYieldRate: number }
```
- 木取り画面の「必要な材料」「歩留まり」「全体の歩留まり」はこれを出す（暫定。未決事項 31）。並びは材料の保存の並び（`packJob` と同じ）で、固定した1枚しか無い材料も入れる

### 11.6 進み具合と残りの材料（`progress/sheetProgress.ts`）

```ts
export interface RemainingPiece {
  rect: Rect             // 1枚の置き方の座標
  pieceIds: string[]     // この中にある、まだチェックしていない片。空なら切り離した余り（端材）
}
export interface SheetProgress {
  doneSteps: number[]    // 済んだ工程（CutStep.no の小さい順）
  nextStep: number | null // 次に切る工程（済んでいない一番小さい no）。全部済めば null
  remaining: RemainingPiece[] // 残りの材料。部材の入っているもの → 端材 の順、それぞれ面積の大きい順
}
export function sheetProgress(layout: SheetLayout, kerf: number, checked: readonly string[]): SheetProgress
```

**済んだ工程**：切る順番の各工程 `CutStep.within`（その工程で2つに分ける長方形）を使う。
- チェックした片を取り出すのに要る工程 ＝ `within` がその片の長方形を含む工程（ギロチンカットの木の「先祖」。端切り・前の帯の切り離し・その帯の切り分け・幅の切り揃え）。比べは小数第1位（0.1mm の誤差を許す）
- 済んだ工程 ＝ チェックした片それぞれに要る工程を合わせたもの。チェックの順番や、切る順番どおりかは問わない（例：2本目の帯の部材を先にチェックすると、1本目の帯を切り離す工程も済みになる）
- 計算した1枚（チェックなし）は `doneSteps: []`・`nextStep: 1`（工程が無ければ null）

**残りの材料**：板全体（端切り前）の長方形から始め、済んだ工程を no の順に当てて分けていく。
- 工程の `within` を含む今の長方形を探し、2つに分ける
  - 縦に切る（線 x = at）：右 `[at, 右端]`、左 `[左端, at − 刃厚]`（刃厚は測った側の反対側＝左で消える。3.3）
  - 横に切る（線 y = at）：上 `[at, 上端]`、下 `[下端, at − 刃厚]`
  - 端切り（kind `trim`）：落とす側（縦は右、横は上）は捨て、残す側は刃厚を引かない（端切りの幅は刃厚を含む）
  - 大きさが 0 以下になる側は捨てる
- 分け終わった長方形のうち、チェックした片とぴったり同じ（0.1mm の誤差まで）ものは除く（切り出した部材）
- 残りを「まだチェックしていない片が入っている長方形」と「片の入っていない長方形（端材）」に分ける。端材は幅・長さとも `MIN_SCRAP`（30mm）以上だけ出す
- 例（第1.7版の見本、メラミン 1 の1枚目＝3×6 縦切り優先・端切り5・刃厚3・側板 410×1810 ×2）
  - 右の側板（x 495〜905）にチェック → 済んだ工程 1・2・3、次は 4。残りの材料は x 0〜492 の 492×1820（もう1枚の側板が入っている）。帯の下の 410×7 は 30mm 未満なので出さない
  - 両方にチェック → 済んだ工程 1〜5、次は無し。残りは端材 79×1820 だけ

### 11.7 1枚ごとのチェックリスト（`progress/sheetChecklist.ts`）

```ts
export interface SheetChecklistRow {
  pieceId: string
  partId: string
  name: string       // 今の部材名（部材が無ければ写しの名前）
  sizeLabel: string  // その1枚の写し（固定した1枚）または計算の結果の木取り寸法
  done: boolean
}
export function sheetChecklist(job: Job, layout: SheetLayout, checked: readonly string[]): SheetChecklistRow[]
```
- 行は切る順番に取り出される順（第1.9版）：`pieceReleaseSteps(layout)`（`progress/sheetProgress.ts`。その片を含む工程のうち一番大きい no）の小さい順、同じなら `layout.placements` の順。帯より細い片は幅を切り揃える工程で取り出すので、同じ帯のあとの片より後になる。1片1行（仕様書 9 の例：天地板 874×410 □、天地板 874×410 □ …）
- ふつうの部材もフラッシュの表面材も同じ形（その1枚の材料が表面材）
- 材料ごとのチェックリスト（`cuttingChecklist`）と、その完了を付け外す `setCutChecklistRow`・`setFlushCutCheck` は使わなくなったので削除した。以前の「木取り済み」を外すのは `clearLegacyCut`（11.9）だけ

### 11.8 保存・コピー（`src/store`）

- 読み込み（`sanitizeJob`）：`frozenSheets` が無ければ `[]`（直した数に数えない）。次のものは読めない1枚として外す（直した数に数える）：id が無い・重複、`boardId` が文字でない、`layout` の数（幅・長さ・長方形）が数でない、`placements` が空、`mode` が縦／横でない
  - `checked`：文字の配列にし、写しに無い pieceId・重複を外す。空になった1枚は外す（固定が外れた状態と同じ）
  - `completedAt`：`checked` がすべての片なら残す（無ければ `frozenAt` を入れる）、そうでなければ消す
  - 材料が削除されていても外さない（写しで表示する）
- **材料を削除しても、固定した1枚は消さない**（写しで表示し、「部材が変わっています」を出す。チェックを外せば消える）
- **仕事のコピー（`copyJob`）では固定した1枚を写さない**（似た家具を作るときは、まだ何も切っていないため）（暫定。未決事項 32）
- 部材の削除・名前の変更・設定の変更・サイズの選択では、固定した1枚を変えない

### 11.9 以前の「木取り済み」（`checks.cut`・`cutByBoard`）の扱い — 移し替えない

- 以前の版の、部材ごとの木取りの完了は **どの1枚のどの片かが分からない** ので、固定した1枚には移し替えない。データはそのまま残す（消さない・書き換えない）
- 意味は今までどおり「木取り済み（計算から除いています）」：`expandPieces` は、その部材（表面材）を計算から除き `done` に入れる（8.5・10.3 のまま）
- 画面では新しく付ける方法をなくし、木取り画面の「木取り済み（計算から除いています）」の一覧に **「外す」** ボタンを置く。押すと `clearLegacyCut(job, partId, boardId)`（ふつうの部材は `checks.cut = false`、フラッシュは `cutByBoard[boardId]` を消す）で計算に戻る
- 固定した片の数（11.3）は、木取り済みの部材には関係しない（部材ごと除くので）
- 寸法表・部材の画面は今のまま（寸法表に木取りの完了は無い。第1.6版から）

### 11.10 木取り画面の並び（`KidoriScreen`）

- 材料ごとの段（材料の表示の並び `orderedBoards`。材料が削除された固定した1枚は最後に、写しの材料名で）
  1. 見出し：材料・枚数（`materialSummaries`）・切り方。切り終わった1枚があれば「切り終わり ◯枚」
  2. **固定した1枚**（切り終わりを除く、固定した順）→ **計算した1枚**（`MaterialResult.sheets`）の順に、通しで「1枚目 / ◯枚」
  3. 1枚ごとに：配置図（チェックした片はグレー、残りの材料の枠と大きさ）→ チェックリスト（`sheetChecklist`）→ 切る順番（`CutSteps`：済んだ工程はグレー、次の工程を目立たせる。第1.6版で外した表示を戻す）→ 端材
  4. 固定した1枚に `drift` があれば、その1枚の上に「部材が変わっています：棚板（寸法）・背板（枚数）」
- 計算した1枚の最初の片にチェックすると、その1枚は固定されて「固定した1枚」の最後に移る（見た目の位置が変わることがある）。今のスクロールの戻し（押した行が同じ位置に残る）を使う
- すべての片にチェックすると、その1枚は画面から消える（仕様書 9）。「切り終わり ◯枚」を押すと切り終わった1枚をグレーで開き、チェックを外せる（暫定。未決事項 29）

### 11.11 実装で決めた細かいこと（engine-dev）

- 片の id の連番（11.3）：固定した片を引いても、表面材ごとに「引く前の枚数」ぶんの番号を取っておく。ある表面材を固定しても、ほかの表面材（材料）の片の id はずれない（固定した表面材の残りは 1 から）
- 「部材が変わっています」（11.5）：1つの部材に理由が重なったら removed → count → size の順で1つにする（枚数0 の行は寸法が出ないことがあるため count を先に見る）
- `sheetProgress`（11.6）：チェックが無い1枚の残りの材料は「板全体（すべての片が入っている）」の1つ。画面はチェックがあるときだけ出す
- 読み込み（11.8）：固定した1枚の `material`・`thickness`・`grain`・`kerf`・`trim`・`frozenAt` が読めなければ初期値（''・1・long・刃厚3・端切り5・仕事の更新日）に直して数える。`layout` は数・片・切る順番のどれかが壊れていれば1枚ごと外す（片の id の重なりも外す）

## 12. 第2.0版の変更（フラッシュの重ね切り）— 決定（planner）

仕様書 4「フラッシュの重ね切り」（コミット 23fc3ba）に対応する。1〜11章と食い違うところは 12章が正。
方針は「**重ねる2つの材料の組を、木取りの上では1つの“材料”として扱う**」。配置・切る順番・歩留まり・固定した1枚・チェックリスト・残りの材料の仕組みはそのまま使い、変えるのは「どの片をどの組に入れるか」と「枚数を両方の材料に数える」ところだけにする。保存データ（`kidori.jobs.v2`）の版は上げない（足すだけ）。

### 12.1 追加・変更するファイル

```
src/engine/
  types.ts               Flush.stack・FrozenSheet.stackWith・MaterialResult.stack・PackingResult.stackMismatches
  packing/stack.ts       canStack・sameSheet・stackKey・stackPlan（どの組を重ねるか・そろっていない組）・stackLabel
  packing/pieces.ts      重ねるフラッシュの片を組の“材料”に入れる（12.3）
  packing/index.ts       packJob(job, dims, plan?)。組の結果は MaterialResult.stack 付き。全体の歩留まりは組の1枚を2回数える
  packing/sizes.ts       今の仕事の stackPlan を比較の計算にも渡す
  hints/saving.ts        組の表示名（stackLabel）
  progress/frozen.ts     freezeSheet の stackWith、frozenDemand は両方の材料に数える、frozenSheetViews・materialSummaries
src/store/
  jobs.ts                validateFlush・cleanFlush（stack）、removeBoards（組が崩れたら stack を外す）、setPieceCheck（stackWith）、setBoardsSize
  storage.ts             Flush.stack・FrozenSheet.stackWith の検査・修復、ひな形の FlushSpec.stack
  template.ts            FlushSpec.stack（引き継ぎ・見本）
src/ui/
  components/FlushEditor.tsx     「表面材を重ねて切る」のチェック
  components/SheetSizePicker.tsx 組のときは2つの材料を同じサイズにする
  screens/KidoriScreen.tsx       組の段・まとめの行・そろっていない知らせ
```

### 12.2 データの形（`types.ts`）

```ts
export interface Flush {
  …今のまま
  /** 表面材を重ねて切る（第2.0版）。オンのときだけ true を持つ（オフは持たない） */
  stack?: true
}

export interface FrozenSheet {
  …今のまま（boardId は組の1つ目の材料）
  /** 重ね切りの1枚（第2.0版）：boardId と一緒に重ねて切った、もう1つの材料（固定したときの写し） */
  stackWith?: { boardId: string; material: string; thickness: number }
}

export interface MaterialResult {
  …今のまま
  /** 重ね切りの組の結果（第2.0版）。このとき boardId は stackKey(a, b)、material・thickness は1つ目の材料のもの */
  stack?: { boardIds: [string, string] }
}

export interface PackingResult {
  …今のまま
  /** サイズ・木目がそろっていないので重ねずに木取りした組（重ねる片があった組だけ。材料の保存の並び） */
  stackMismatches: { boardIds: [string, string]; flushIds: string[] }[]
}
```

- `stack` はオンのときだけ `true` を持つ（`Board.builtIn` と同じ書き方。以前のデータはそのままオフ）
- **組の並び**：2つの材料は `job.boards` の保存の並び（追加した順。変わらない）で前を1つ目 a、後ろを2つ目 b にする。フラッシュの表面材の並びにはよらない。材料の保存の並びは変わらないので、固定した1枚の `boardId`＝a・`stackWith.boardId`＝b もずれない
- `stackKey(a, b)` ＝ `` `stack:${a}+${b}` ``。組の結果・比較・まとめの id に使う。**文字列を分解して材料の id を取り出すことはしない**（いつも `boardIds` を一緒に持つ）

### 12.3 どの組を重ねるか（`packing/stack.ts`）

```ts
canStack(flush): boolean              // 表面材がちょうど2つで、枚数が同じ（材料があるかは見ない）
sameSheet(a: Board, b: Board): boolean // 短辺・長辺（小数第1位）と木目がそろっている
stackKey(a: string, b: string): string
interface StackGroup    { key: string; boardIds: [string, string]; flushIds: string[] }
interface StackMismatch { boardIds: [string, string]; flushIds: string[] }
stackPlan(job): { groups: StackGroup[]; mismatches: StackMismatch[] }
stackLabel(job, boardIds): string     // 「メラミン1＋ラワン4（重ね切り）」（boardTokenLabel を ＋ でつなぐ。材料が無ければ写しの名前を使う側で渡す）
```

- `stackPlan`：`stack` がオンで `canStack` で、表面材の材料が2つとも仕事にあるフラッシュについて、組（a, b）を作る。`sameSheet` なら `groups`、そうでなければ `mismatches`。同じ組のフラッシュが複数あれば1つの組にまとめる（`flushIds` に並べる。**違うフラッシュでも同じ2つの材料なら同じ配置図に並べる**。暫定。未決事項 37）。並びは a の保存の並び → b の保存の並び
- 「サイズがそろっている」は **短辺・長辺・木目が同じ** で判定する（3×6 と、自由入力の 910×1820 は同じとみなす。仕様書の「サイズ（3×6／4×8／自由入力）」を、実際の大きさで比べる形にした。暫定。未決事項 38）
- 1つの材料がいくつかの組に入ってもよい（例：A＋B と B＋C）。組ごとに別の配置図になる

### 12.4 片の展開（`packing/pieces.ts`・`packing/index.ts`）

`packJob(job, dims, plan = stackPlan(job))`・`expandPieces(job, dims, plan = stackPlan(job))`。`plan` を引数にするのは、サイズの比較（12.7）で「今の仕事で重ねている組」を保ったまま計算するため。

- 重ねるフラッシュ（`plan.groups` のどれかの `flushIds` に入っている）の部材は、今までどおり表面材ごとの残りの枚数（以前の木取り済み・固定した片を引いた後）を出してから：
  - **重ねる片の数 ＝ min(a の残り, b の残り)**。この数だけ「重ねた片」を組の“材料”に入れる
  - 残りの差（a の残り − 重ねる数、b も同じ）は、今までどおりそれぞれの材料にふつうの片として入れる（ふだんは 0。重ねる前に片方だけ固定したときや、以前の木取り済みが片方だけのときに出る）
- 重ねた片の向きは a の材料（`sameSheet` なので b も同じ）で決める。寸法・木目・`sizeLabel` は部材のまま。片の id は a の表面材の番号（11.11 の連番の a の分）を使う（組の配置図の中で重ならなければよい）
- 組の“材料”：`BoardPieces` に `stack?: { key; boardIds }` を足す。`board` は a（大きさ・木目に使う）。並びは、組の a の位置（`job.boards` の並び）の直後
- 寸法のエラー・厚みの不一致・材料が無い（`skipped`）の判定は今までどおり部材ごとに1回
- `packJob` の組の結果：`boardId: stackKey`、`material`・`thickness` は a のもの、`stack: { boardIds }`。配置・切る順番・歩留まり（1枚＝a の1枚の面積に対して）はふつうの材料と同じ計算。おまかせも組ごとに選ぶ
- `PackingResult.totalYieldRate`：組の1枚は **2枚分（a と b）** として面積を数える
- `stackMismatches`：`plan.mismatches` のうち、重ねるはずの片が1つ以上あった組（そろっていれば重ねていた数が 1 以上）。その組の片は今までどおりそれぞれの材料でふつうに木取りする
- 重ねた配置図には重ねる片だけが入る（ほかの部材は入らない）＝仕様書「ほかの部材は並べない」

### 12.5 固定した1枚とチェック（`progress/frozen.ts`・store の `setPieceCheck`）

- `freezeSheet(job, boardId, mode, layout, id, now, stackWith?: string)`：`stackWith` があれば、その材料の材料名・厚みも写して `FrozenSheet.stackWith` に入れる（木目・大きさは a と同じなので a から写す）
- store の `SheetTarget` の `computed` に `stackWith?: string` を足す。画面は組の結果なら `boardId: stack.boardIds[0]`、`stackWith: stack.boardIds[1]` を渡す
- `frozenDemand`：`stackWith` のある1枚は、片1つにつき `partId|a` と `partId|b` の **両方に 1** を数える。これで **1回のチェックが2種類の両方に付く**（固定した1枚1つに `checked` が1つなので、チェックは1回）。12.4 の「残り」はこれを引いた後の数
- チェックの付け外し・切り終わり・固定の外れ（11.4）はそのまま。全部外れると組の1枚が消え、片は（そのときの設定で）重ねて、またはふつうに並べ直す
- **重ね切りをオフにしても、固定した組の1枚は消さない**（切った記録。両方の材料から引き続ける）。オフにした後の残りは、それぞれの材料でふつうに並ぶ（暫定。未決事項 39）
- `frozenSheetViews`：
  - `label` は組の表示名（`stackLabel`。材料が無ければ写しの材料名で「メラミン1＋ラワン4（重ね切り）」）
  - 「部材が変わっています」は、a・b のそれぞれについて今までの判定（11.5）を行い、部材ごとに1つにまとめる：どちらかの材料から切らなくなった → `removed`、どちらかで 固定した片の数 ＞ 今の枚数 → `count`、寸法 → `size`。重ね切りのオン・オフや、サイズがそろっていないことは drift にしない
- `materialSummaries(job, result, views)`：
  - **材料ごとの行**（今まで）：`sheetCount` ＝ その材料の 固定した1枚（切り終わりを除く）＋ 計算した1枚 ＋ **その材料が入っている組の1枚（固定・計算とも、切り終わりを除く）**。歩留まりも同じ1枚たちで出す。`stackedCount`（そのうち組の1枚の数）を足す。`completedCount` はその材料だけの切り終わり
  - **組の行**を足す：`boardId: stackKey`、`stack: { boardIds }`、その組の 固定した1枚＋計算した1枚 の枚数・歩留まり・切り終わりの数。組の固定した1枚しか無い（重ね切りをオフにした）組も出す（組の行の `stackedCount` は `sheetCount` と同じ）
  - 並び：材料の保存の並びで、組の行は a の行の直後。組の行の後ろに、その組の材料の行が来ることもある（b）
  - `totalYieldRate`：材料ごとの行の1枚たちで出す（組の1枚は a・b の行の両方に入るので2回数える。組の行は足さない）
  - 例：見本で重ね切りオン → 組 5枚・メラミン 1 は 5枚（うち重ね切り 5）・ラワン 4 は 6枚（うち重ね切り 5）。全体の歩留まりは重ねないときと同じ 86.4%
- `sheetProgress`・`sheetChecklist` は変えない（1枚の写しだけを見るため）

### 12.6 保存・操作（`src/store`）

- `validateFlush`：`stack` が true なら `canStack` であること。違えば「重ねて切れるのは、表面材が2種類で枚数が同じときだけです」。`cleanFlush` は `stack` が true のときだけ残す
- `removeBoards`：表面材を外した結果 `canStack` でなくなったフラッシュは `stack` を外す
- 読み込み（`sanitizeFlushes`）：`stack` は `true` で `canStack` のときだけ残す。それ以外で `stack` があれば外して直した数に数える
- 読み込み（固定した1枚）：`stackWith` があれば、`boardId` が文字で自分の `boardId` と違うこと。`material`・`thickness` が読めなければ 11.11 と同じ初期値に直して数える。`boardId` が読めない・同じなら **1枚ごと外す**（どの材料から引くか分からないため。直した数に数える）
- ひな形（`FlushSpec`）に `stack?: true` を足し、新しい仕事・見本に引き継ぐ（材料名＋厚みで材料を探した結果 `canStack` でなければ外す）。仕事のコピーはフラッシュごと写すので `stack` も写る（固定した1枚は写さない＝11.8 のまま）
- `setBoardSize(job, boardId, size)`：重ね切りの組の材料なら、**相手の材料も同じサイズにする**（決定。未決事項 36）。相手は「重ね切りがオンで `canStack` のフラッシュの2つの表面材」をたどれるだけたどった材料（A＋B と B＋C なら A を選ぶと A・B・C）。重ね切りがオフの材料はその材料だけ
- `setBoardsSize(job, boardIds, size)`：いくつかの材料を1回の操作で同じサイズにする（相手の材料も同じくそろえる。1回の保存）。組のサイズの選択で使う

### 12.7 サイズの比較・お知らせ（`packing/sizes.ts`・`hints/saving.ts`）

- `compareStandardSizes(job, dims)`：**今の仕事の `stackPlan(job)`** を求め、3×6・4×8 にそろえた写しの `packJob(写し, dims, plan)` に渡す。すべての材料を同じサイズにすると組は必ずそろうので、そのまま計算すると「今は重ねていない（そろっていない）組」まで重ねた結果になってしまうため
  - 組にも比較が出る（`boardId: stackKey`、`stack: { boardIds }` 付き）。材料ごとの比較は、その材料のふつうの片がある材料だけ（今までどおり `packJob` の材料と同じ並び・対象）
- お知らせ（`findSavingHints`）：組の結果もほかの材料と同じく比べる（`boardId` が stackKey）。表示名は `stackLabel`：「切り代を 7mm にすると、メラミン1＋ラワン4（重ね切り）が 1 枚減ります（5枚 → 4枚）」。切り代・端切りを変えても組の決まり方は変わらない（サイズ・木目で決まるため）

### 12.8 画面（`src/ui`）

| 画面 | 変更 |
|---|---|
| 設定のフラッシュ | 表面材の下に「表面材を重ねて切る（2枚重ね）」のチェック（44px 以上）。`canStack` でないときは押せず、「表面材が2種類で、枚数が同じときに選べます」を出す。表面材を変えて `canStack` でなくなったら、下書きのチェックを外す。説明（2種類を1枚ずつ重ねて1回で切る）は見出しの ⓘ に入れる（仕様書 9.1）。一覧の行に「重ね切り」と出す |
| 木取り：まとめ | 組の行「メラミン1＋ラワン4（重ね切り）」（枚数・歩留まり・切り方・サイズの選択）。材料の行は、組の1枚を含んだ枚数に「うち重ね切り ◯枚」を添える。材料の行のサイズの選択は、その材料のふつうの片があるときだけ（今までどおり比較のある材料だけ） |
| 木取り：組のサイズの選択 | 3×6・4×8・自由入力のどれを選んでも、`setBoardsSize` で **2つの材料を同じサイズにする**。比較の数は組の比較（`compare` の stackKey） |
| 木取り：知らせ | `result.stackMismatches` の組ごとに、まとめの上に「メラミン1＋ラワン4：サイズがそろっていないので、重ねずに木取りしています」 |
| 木取り：1枚ごとの段 | 組の段を、a の材料の段の直後に置く（見出し「メラミン1＋ラワン4（重ね切り）」）。固定した組の1枚（`stackWith` のあるもの）→ 計算した組の1枚 の順。配置図の木目・端切りは a。チェックは今までどおり1片1回（`setPieceCheck` に `stackWith` を渡す） |

- 材料のサイズの選択を材料の行で変えても、重ね切りの組の相手の材料も同じサイズになる（`setBoardSize`。決定。未決事項 36）。サイズを設定の材料の編集で変えたときなど、組の相手とサイズが違えば重ねずに木取りし、上の知らせが出る

## 13. 第2.1版の変更（8回目の要望）— 決定（進行役）

仕様書の差分は コミット 1ffbc57。保存データの版は上げない（移し替えなし）。

### 13.1 切り代はフラッシュの部材だけ（`dimensions/cutSize.ts` の `partAllowance`）

- 部材の切り代 ＝ 部材ごとの上書き（`part.allowance`。0 も有効）があればそれ。無ければ、フラッシュの部材（`flushId` あり）は設定の切り代、フラッシュでない部材は 0
- 保存データは書き換えない。以前の版で保存した仕事は、フラッシュでない部材で上書きしていないものの木取り寸法が、切り代の分だけ小さくなる（計算の仕方が変わるだけ）。固定した1枚は写しのままなので変わらない（寸法が変わったことは「部材が変わっています」で知らせる。11.5）
- お知らせ（`findSavingHints`）：設定の切り代を使う部材（フラッシュ・上書きなし・枚数1以上）が無ければ切り代を試さない（試しても何も変わらないため）。端切りは今までどおり
- 以前の版の逃げの移し替え（`migrate/v1Dimensions.ts`）の比べる計算も `partAllowance` を使う（切り代の決め方の違いを、移し替えで変わった部材として知らせないため）
- テストの見本（`fixtures/bookshelf.ts`。シナランバー）は、今までの期待値（切り代 10）のまま使えるよう、側板・天地板・棚板に部材ごとの切り代 10 を入れた

### 13.2 重ね切りの初期値（`engine/flush.ts` の `defaultFlushStack`）

- 新しいフラッシュの「表面材を重ねて切る」の初期値は `defaultFlushStack(faces)`＝`canStack`（表面材が2種類で枚数が同じならオン、ほかはオフ）
- 見本が足すフラッシュ25 は `stack: true`。ひな形にあるフラッシュ25 を使うときは、ひな形の設定のまま（オフならオフ）。ひな形の初期値（`defaultTemplate`）は変えない（フラッシュを持たないため）

### 13.3 まとめ（`materialSummaries`）

- **材料の行**：その材料をふつうに木取りする分だけ（固定した1枚（切り終わりを除く）＋計算した1枚。組の1枚は足さない）。`stackedCount` は材料の行では 0（名前は残す）
- ふつうの1枚・固定した1枚・切り終わりのどれも無い材料（例：重ね切りの組だけで使うメラミン 1）は行を出さない
- **組の行**は今までどおり（`stackedCount` は `sheetCount` と同じ）。並びも今までどおり（材料の保存の並びで、a の位置の直後。a の行が無ければ a の位置に組の行だけ）
- `totalYieldRate` は変えない（組の1枚は a・b の両方の材料を使うので2回数える）
- 例：重ね切りオンの見本 → 組 5枚・ラワン 4 1枚（背板 97.8%）・メラミン 1 の行は無い。全体 86.4%

## 14. 第2.2版の変更（手持ちの材料 第1段階）— 決定（planner）

仕様書 9「手持ちの材料（第1段階）」（コミット 5e7ea2f）に対応する。1〜13章と食い違うところは 14章が正。
方針は「**どの材料も“手持ち”で木取りする。サイズを1つ選んだ材料は、そのサイズが無限にある手持ちとみなす**」。帯詰めは1つの処理のまま、新しい1枚を出すときに「どの大きさの材料を使うか」を選ぶところだけ足す。手持ちを登録しない材料は今までとまったく同じ結果になる（今のテストがそのまま通ること）。保存データ（`kidori.jobs.v2`）の版は上げない（足すだけ）。

### 14.1 追加・変更するファイル

```
src/engine/
  types.ts               StockSheet・Board.stockOn・Board.stock・SheetLayout.sheet・Unplaced の 'noStock'・StackMismatch の理由
  packing/stock.ts       stockKinds（材料の手持ち）・stockSizeLabel・availableStock（固定した1枚を引いた残り）・commonStock（組の手持ち）
  packing/pieces.ts      Piece.shape（手持ちの大きさごとに向きを決め直すため）・Piece.twin（組の片の b の id）
  packing/guillotine.ts  1枚ごとに大きさ（frame）を持つ。新しい1枚は「入る一番小さい手持ち」を選ぶ
  packing/index.ts       手持ちで木取り・組 → 材料の順に手持ちを使う・組に置けなかった片を a・b に回す
  packing/sizes.ts       比較の写しでも手持ちの材料はそのまま（サイズを替えない）
  hints/saving.ts        手持ちが足りない材料はお知らせを試さない
  hints/shortage.ts      stockShortage（足りないときの解決策）
  progress/frozen.ts     freezeSheet の木目を layout.sheet から・materialSummaries の bySize・stockUsage
src/store/
  jobs.ts                setStockMode・addStockSheet・updateStockSheet・removeStockSheet
  storage.ts             Board.stockOn・Board.stock の検査・修復
src/ui/
  components/StockEditor.tsx   手持ちの材料の編集（材料ごと）
  screens/KidoriScreen.tsx     「手持ちの材料」の段・まとめのサイズ別の枚数・1枚ごとのサイズ・足りない知らせ
```

### 14.2 データの形（`types.ts`）

```ts
/** 手持ちの材料の1行（第2.2版）。例：4×8 ×3枚 */
export interface StockSheet {
  id: string              // その材料の中で重複しない（newId('stock')）
  sizeKind: BoardSizeKind // 3×6／4×8／自由入力
  width: number           // 短辺（3×6・4×8 は決まった値）
  length: number          // 長辺
  grain: BoardGrain       // 3×6・4×8 は 'long'
  count: number           // 枚数（1以上の整数）
}

export interface Board {
  …今のまま（sizeKind・width・length・grain は「サイズを選ぶ」ときのサイズ）
  /** 手持ちで木取りする（第2.2版）。オンのときだけ true を持つ */
  stockOn?: true
  /** 手持ちの材料（登録順）。オフにしても消さずに残す（切り替えて戻せるように） */
  stock?: StockSheet[]
}

export interface SheetLayout {
  …今のまま（boardWidth・boardLength はその1枚の大きさ）
  /** 手持ちで木取りした1枚（第2.2版）：使った手持ちの行と木目。サイズを選んだ材料では持たない */
  sheet?: { stockId: string; sizeKind: BoardSizeKind; grain: BoardGrain }
}

// MaterialResult.unplaced の reason に 'noStock'（手持ちが足りない・手持ちのどれにも入らない）を足す
// PackingResult.stackMismatches の各組に reason: 'size' | 'stock' を足す
```

- **手持ちで木取りするか** は `stockOn === true` だけで決める。手持ちが0行のままオンにはしない（14.8 の `setStockMode` が最初の1行を入れる）
- 手持ちは材料（`Board`）に持つ（8.2 と同じ理由：材料の削除・仕事のコピー・保存の検査でずれない）。ひな形（8.3）には入れない（新しい仕事は手持ちなしで始まる）

### 14.3 材料の手持ち（`packing/stock.ts`）

```ts
export interface StockKind {
  stockId: string | null   // サイズを選んだ材料は null
  sizeKind: BoardSizeKind
  width: number; length: number; grain: BoardGrain
  count: number            // 使える枚数。サイズを選んだ材料は Infinity
}
stockKinds(board): StockKind[]              // stockOn なら stock の行（登録順）、そうでなければ選んだサイズ1つ（count: Infinity）
stockSizeLabel(s): string                   // 3×6 → "3×6"、4×8 → "4×8"、自由入力 → "900×450"（短辺×長辺）
availableStock(job, boardId): StockKind[]   // 固定した1枚の分を引いた残り（14.6）
commonStock(a: StockKind[], b: StockKind[]): StockKind[] // 大きさ・木目（sameSheet）がそろう行どうし、枚数は少ないほう。並びは a の順
```

### 14.4 手持ちで並べる（`packing/guillotine.ts`）

- `packGuillotine(pieces, stock: SheetSpec[], kerf, mode)` にする。`SheetSpec` は手持ちの1行（`StockKind`）＋ その大きさの `usable`・`frame`（`usableRect`・`frameOf` を1行ごとに作る）。**1枚ごとに自分の frame を持ち**、帯の幅・長さの上限はその1枚のものを使う
- 片の向きは1枚ごと（大きさ・木目）に決める：`Piece.shape`（面の2軸の木取り寸法 s0・s1 と、どちらの軸に木目を通すか 0／1／'any'）から、pieces.ts の `orientationsOn` と同じ規則で求める（手持ちの行ごとに1回だけ計算して持っておく）
- 並べる順：今までどおり「帯の幅の大きい順 → 長さの大きい順」。基準の向きは、その片が入るどの手持ちの行でも同じ規則（帯の中の方向に長く置く向き）で、一番大きい値を使う（サイズを選んだ材料では今と同じ順になる）
- 1片ずつ：① 開いている1枚の帯に First Fit ② 開いている1枚に新しい帯 ③ **新しい1枚を出す：残りの枚数が 1 以上で、その片が入る手持ちの行のうち、面積（短辺×長辺）が一番小さい行**（同じ面積なら登録順で前）を1枚使う（仕様書 9「大きい部材から順に、それが収まる一番小さい材料」）④ どの行にも入らない → 入らない片
- 入らない片の理由：サイズを選んだ材料は今までどおり `tooLarge`。手持ちの材料は **すべて `noStock`**（手持ちが尽きた・手持ちのどの大きさにも入らない。どちらも「足りない」として 14.7 で解決策を出す）
- サイズを選んだ材料（1行・無限）では、今の `packGuillotine` と同じ結果になること（今のテストがそのまま通る）
- 計算量は 片 × 帯 ＋ 片 × 手持ちの行数。部材150枚・手持ち3行・おまかせで `packJob` が 1秒以内

### 14.5 木取りの入口（`packing/index.ts`）

- 材料ごとに `availableStock` で並べる。1枚ごとの `SheetLayout` は、その1枚の大きさで `trims`・`usable`・`cuts`・`scraps`・歩留まりを出す（端切りは1枚ごとの大きさに当てる）。手持ちの材料の1枚には `sheet`（手持ちの行・木目）を付ける
- **おまかせ**：縦切り優先・横切り優先をそれぞれ手持ち全体で並べて比べる。入らない片が少ない → 枚数が少ない → **使った材料の面積の合計が小さい**（大きさが混ざるときのため。1つの大きさなら枚数が同じなら面積も同じなので今と変わらない。未決事項 41）→ 一番大きい端材が大きい → 縦切り優先
- `sheetCount` はその材料で使った1枚の数（大きさを問わない）。歩留まりの分母は使った1枚それぞれの面積の合計（3.3 と同じ考え方）

### 14.6 固定した1枚と手持ち

- 固定した1枚（**切り終わりを含む**。未決事項 40）は、その材料の手持ちの行のうち、大きさ（`layout.boardWidth`・`boardLength`、小数第1位）と木目（`FrozenSheet.grain`）がそろう最初の行（残りが 1 以上）から1枚引く。そろう行が無ければ引かない（手持ちを書き換えた後など）
- 組の固定した1枚（`stackWith`）は a・b の両方から1枚ずつ引く
- `freezeSheet` の `grain` は `layout.sheet?.grain ?? 材料の grain`（手持ちの1枚は、その行の木目を写す）

### 14.7 重ね切りの組と手持ち（`packing/stack.ts`・`packing/index.ts`）

- 組の手持ち ＝ `commonStock(a の availableStock, b の availableStock)`。サイズを選んだ材料は「そのサイズが無限」なので、手持ちを使わない2つの材料では今の `sameSheet` と同じ判定になる。片方だけ手持ちでも同じ規則（手持ちの側の、相手の選んだサイズとそろう行が組の手持ちになる）
- `stackPlan`：登録した手持ちどうし（`commonStock(stockKinds(a), stockKinds(b))`。固定した1枚は引かない）がそろう行が1つも無い組は `mismatches`（固定で使い切っただけなら組のまま。並べる片が無ければ組の結果も出ない）。理由は、どちらも手持ちを使わないなら `'size'`（今の知らせ「サイズがそろっていないので…」）、どちらかが手持ちなら `'stock'`（「同じサイズの手持ちが無いので、重ねずに木取りしています」）
- 計算の順：**組（plan の並び）を先に並べ、使った1枚を a・b の手持ちから引いてから**、材料ごとのふつうの片を残りの手持ちで並べる（A＋B と B＋C のように1つの材料が2つの組に入るときも、組の並びで順に引く）
- **組に置けなかった片**（組の手持ちが尽きた）は、組が手持ちを使っている（どちらかが `stockOn`）ときだけ、a・b それぞれのふつうの片に回す（仕様書「重ねられる枚数は、そのサイズの手持ちの少ないほう」。重ねられない分は別々に切る）。b の片の id は `Piece.twin`（expandPieces が組の片を作るときに b の表面材の番号で振っておく）。どちらも手持ちを使わない組は今までどおり（組の `unplaced` に `tooLarge`）

### 14.8 足りないときの解決策（`hints/shortage.ts`）

```ts
export interface StockShortage {
  boardId: string
  label: string                          // 「シナランバー 18mm」
  missing: string[]                      // 入らない部材の名前（部材の並び）
  add: { kind: 'saburoku' | 'shihachi'; count: number | null }[] // 3×6、4×8 の順。null ＝ 足しても入らない
  change: { kind: 'allowance' | 'trim'; value: number } | null   // 手持ちのままで入る設定（一番大きい値）
  message: string                        // 「シナランバー 18mm が足りません（入らない部材：棚板）」
}
export function stockShortage(job: Job, dims: DimensionResult): StockShortage[]
```

- 対象：`stockOn` の材料で、その材料のふつうの結果に `noStock` の片がある材料（材料の保存の並び）。無ければ `packJob` を追加で呼ばずに `[]`
- **足す枚数**：3×6・4×8（木目 長手方向）それぞれについて、足りない材料すべてに同じ n 枚の行を足した写しで `packJob` し、n = 1 から増やして、その材料の `noStock` が無くなった最初の n を記録する。上限は足りない片の数（それで無くならなければ null）。入らない片のうち1つでもそのサイズに入らない（向き・端切り込み）材料は、そのサイズは試さず null
- **設定を変えて手持ちで入るか**：お知らせ（6.7・E-25）と同じ試し方。切り代（設定の切り代を使う部材があるときだけ）を `smallerSteps` で大きい値から → 切り代で入らなかった材料だけ端切り。その材料の `noStock` が無くなる一番大きい値。組み合わせは試さない
- 計算の回数は 最大で（3×6 の n）＋（4×8 の n）＋ 切り代 ＋ 端切り の `packJob`。部材150枚で 1秒以内
- お知らせ（`findSavingHints`）は、`noStock` のある材料（とその材料の入る組）を「減らせる」の対象から外す（足りないときは解決策だけを出す）

### 14.9 比較・まとめ（`packing/sizes.ts`・`progress/frozen.ts`）

- `compareStandardSizes`：手持ちで木取りする材料（`stockOn`）は写しでもそのまま残し、ほかの材料だけ 3×6／4×8 にする（重ね切りの組・比べる材料の並びを今の packJob とそろえるため）。手持ちの材料の比較は画面に出さない（**第2.3版の修正で変更**：15.5 のとおり手持ちの行も 3×6／4×8 にして比べ、画面に出す）
- `MaterialSummary.bySize: { label: string; count: number }[]`：その行の1枚（固定した1枚（切り終わりを除く）＋計算した1枚）を大きさごとに数えたもの。並びは大きい面積から（例：`4×8 ×2`・`3×6 ×1`）。サイズを選んだ材料でも1つ出す（画面は手持ちの材料のときだけ出す）
- `stockUsage(job, result): { boardId; rows: { stockId; label; count; used; left }[] }[]`：`stockOn` の材料ごとに、手持ちの行ごとの 使った枚数（固定した1枚（切り終わりを含む）＋組の1枚＋計算した1枚）と残り（count − used。0 未満にしない）。手持ちの編集欄に出す

### 14.10 保存・操作（`src/store`）

- 読み込み（`sanitizeBoard`）：`stockOn` は `true` のときだけ残す。`stock` は配列でなければ外す。行ごとに、id が文字で重複しない・`sizeKind` が3つのどれか・枚数が1以上の整数・自由入力は短辺・長辺が 0 より大きい数、でなければ行を外す（直した数に数える）。3×6・4×8 の寸法と木目は決まった値に直す。自由入力の短辺＞長辺は入れ替える。`stockOn` で行が0になったら `stockOn` を外す
- `setStockMode(job, boardId, on)`：オンにするとき行が無ければ、今選んでいるサイズ ×1 の行を1つ入れる。オフは `stockOn` を外すだけ（行は残す）
- `addStockSheet(job, boardId, draft, id?)`・`updateStockSheet(job, boardId, stockId, draft)`・`removeStockSheet(job, boardId, stockId)`：3×6・4×8 は寸法と木目を決まった値にする。自由入力は短辺・長辺が 0 より大きい（短辺≦長辺に並べ直す）。枚数は1以上の整数（「枚数は1以上の整数にしてください」）。最後の1行を消すと `stockOn` も外す
- 仕事のコピー（`copyJob`）は材料ごと写すので手持ちも写る。ひな形（`templateOf`）は変わらない（手持ちを変えても最後に使った設定は更新しない）
- 重ね切りの組の相手の手持ちはそろえない（`setBoardSize` の相手をそろえる処理は「サイズを選ぶ」ときだけ）

### 14.11 画面（`src/ui`）

| 画面 | 変更 |
|---|---|
| 木取り：手持ちの材料 | まとめの下に「手持ちの材料」の段。木取りする片のある材料（組だけで使う材料を含む）ごとに、「サイズを選ぶ／手持ちで木取り」の切り替え（44px 以上）。手持ちのときは行ごとに サイズ（3×6／4×8／自由入力。自由入力は短辺・長辺・木目）・枚数（数字キー）・「使う ◯／残り ◯」（`stockUsage`）・削除、下に「手持ちを足す」。説明は見出しの ⓘ |
| 木取り：まとめ | 手持ちの材料の行は、サイズの選択のかわりに `bySize`（「4×8 ×2・3×6 ×1」）。組の行は、a・b のどちらかが手持ちならサイズの選択を出さず `bySize` |
| 木取り：足りない知らせ | まとめの上に `stockShortage` ごとに「シナランバー 18mm が足りません（入らない部材：棚板）」と解決策（「3×6 を 1枚 足すと入ります」「4×8 を 1枚 足すと入ります」「端切りを 3mm にすると手持ちで入ります」。null のサイズは出さない）。設定・手持ちは自動では変えない |
| 木取り：1枚ごとの段 | 手持ちの1枚は「1枚目 / 3枚（4×8）」のように大きさを添える（`stockSizeLabel`）。配置図の木目は `layout.sheet?.grain` |
| 木取り：組の知らせ | `stackMismatches` の理由が `'stock'` なら「メラミン1＋ラワン4：同じサイズの手持ちが無いので、重ねずに木取りしています」 |

## 15. 第2.3版の変更（まとめの行ごとのサイズ・自由入力＝手持ち・厚みの置き換え）— 決定（planner）

仕様書の差分は コミット 035e841（4「フラッシュの重ね切り」の最後の項、5.4 の厚みの置き換え、9「材料のサイズの選択」「手持ちの材料」）。12章・14章と食い違うところは 15章が正。

方針は「**まとめの1行 ＝ 1つの“サイズの設定”**」。材料の行の設定は今までどおり `Board` に持ち、重ね切りの組の行の設定は仕事の中の別の表（`Job.stackSheets`）に持つ。どちらも同じ形（`SheetChoice`）なので、手持ちの取り出し・帯詰め・比較・まとめ・足りないときの解決策は、同じ関数に「行の設定」を渡すだけにする。

- 組は **2つの材料のサイズがそろっているかを見なくなる**。組は自分のサイズ（または手持ち）で並べ、材料の行のサイズは、その材料をふつうに木取りする片だけに効く
- **「サイズがそろっていないので重ねない」はなくなる**（`stackPlan` の `mismatches`・`PackingResult.stackMismatches`・画面の知らせを消す）
- **相手の材料のサイズをそろえる処理（12.6 の `setBoardSize` の相手・`setBoardsSize`）はなくす**（未決事項 36 の決定は、組が自分のサイズを持つことで不要になる）
- 保存データ（`kidori.jobs.v2`）の版は上げない（`Job.stackSheets` を足すだけ。無い仕事は読み込むときに1回だけ作る。15.6）

### 15.1 追加・変更するファイル

```
src/engine/
  types.ts               SheetChoice・StackSheet・Job.stackSheets。stackMismatches を消す
  packing/stock.ts       stockKinds(choice)・stackChoice（組の設定。無ければ 4×8）・availableStock を材料と組で分ける
  packing/stack.ts       stackPlan は mismatches を返さない。sameSheet は使わなくなる（消してよい）
  packing/index.ts       組は組の手持ちで並べる。材料の手持ちから引かない。置けなかった片は組の noStock（a・b に回さない）
  packing/sizes.ts       比較の写しで、手持ちでない組の設定も 3×6／4×8 にする
  progress/frozen.ts     freezeSheet の組の木目・大きさ、materialSizeCounts・stockUsage に組の行
  hints/shortage.ts      組の行も対象にする
  formula/usages.ts      swapThicknessRef（部材1つの式の {t:旧} を {t:新} に置き換える）
src/store/
  jobs.ts                行の操作（SizeTarget：材料の id か組の2つの id）・copyJob・removeBoards
  storage.ts             stackSheets の検査・修復と、無い仕事の移し替え（15.6）
  sample.ts              見本の組の設定を 3×6 にする
src/ui/
  screens/KidoriScreen.tsx       「手持ちの材料」の段を消す。まとめの行ごとに 3×6／4×8／自由入力、自由入力でその行の手持ちの編集
  components/SheetSizePicker.tsx 組の行も材料の行も同じ部品（SizeTarget を渡す）。自由入力＝手持ち
  components/StockEditor.tsx     行（SizeTarget）ごとの手持ちの編集
  components/PartEditor.tsx      材料を変えたときの厚みの置き換えと知らせ・元に戻す
```

### 15.2 データの形（`types.ts`）

```ts
/** まとめの1行のサイズの設定（第2.3版）。材料の行は Board、組の行は StackSheet がこの形を持つ */
export interface SheetChoice {
  sizeKind: BoardSizeKind
  width: number
  length: number
  grain: BoardGrain
  /** 自由入力（＝手持ち）を選んでいる。オンのときだけ true */
  stockOn?: true
  /** 手持ちの材料（登録順）。3×6／4×8 に戻しても消さずに残す */
  stock?: StockSheet[]
}

export interface Board extends SheetChoice { …今のまま（id・material・thickness・builtIn） }

/** 重ね切りの組の行のサイズの設定（第2.3版） */
export interface StackSheet extends SheetChoice {
  /** 組の2つの材料（a・b。材料の保存の並び）。探すときは並びを問わない */
  boardIds: [string, string]
}

export interface Job {
  …今のまま
  /** 重ね切りの組の行のサイズの設定（第2.3版）。組ごとに1つ。読み込んだあとはいつもある（15.6） */
  stackSheets: StackSheet[]
}
// PackingResult.stackMismatches・StackMismatchReason・StackPlan.mismatches は消す
```

- 組の設定を材料（`Board`）やフラッシュに持たせないのは、組が「2つの材料の組」で決まり（違うフラッシュでも同じ2つの材料なら1つの組。未決事項 37）、どちらか一方の材料に持たせると、材料の行の設定と区別できないため
- **組の設定が無い組**（新しくフラッシュを足した・重ね切りをオンにした）は **4×8**（仕様書 9「初期値は 4×8」）として計算する。設定の表に行を足すのは、組の行でサイズ・手持ちを選んだときだけ（`stackChoice(job, boardIds)` が、行が無ければ 4×8 の設定を返す）
- 重ね切りをオフにした・フラッシュを消した組の設定は消さずに残す（オンに戻したときに同じ設定になる。手持ちの行を残すのと同じ考え）。材料を削除したら、その材料の入る組の設定は消す（15.5）

### 15.3 行の設定から手持ちを取り出す（`packing/stock.ts`）

```ts
stockKinds(choice: SheetChoice): StockKind[]         // 今の stockKinds(board) と同じ中身。引数の型だけ広げる
stackChoice(job, boardIds): SheetChoice               // 組の設定（並びを問わずに探す）。無ければ 4×8・木目 長手・手持ちなし
availableStock(job, boardId): StockKind[]             // 材料の手持ち。固定した1枚のうち、組の1枚（stackWith あり）は引かない
availableStackStock(job, boardIds): StockKind[]       // 組の手持ち。組の固定した1枚（boardId＝a・stackWith.boardId＝b）だけを引く
```

- **「自由入力を選んでいる」＝ `stockOn === true`**（仕様書 9「自由入力を選ぶと、その行の手持ちの材料を登録する」）。3×6・4×8 を選ぶと `stockOn` を外す（行は残す）
- 以前の版の「自由入力」（`sizeKind: 'custom'` で `stockOn` が無い＝1つの大きさが何枚でも使える）は、そのまま今までどおり計算する（移し替えない。暫定。未決事項 44）
- `commonStock` は使わなくなる（組は自分の手持ちを持つため）。消してよい

### 15.4 木取り（`packing/stack.ts`・`packing/index.ts`）

- `stackPlan(job)`：重ね切りがオンで `canStack` で、表面材の材料が2つとも仕事にあるフラッシュを、今までどおり2つの材料の組にまとめる（並び・`flushIds` は今のまま）。**サイズ・手持ちは見ない**（どの組も `groups` に入る）
- 組の片：12.4 のまま（重ねる数＝min(a の残り, b の残り)、差はそれぞれの材料のふつうの片）。片の向きは組の手持ちの行（`stackChoice` の大きさ・木目）で決める（今の a の材料で決めていたところ）
- 組の並べ方：`availableStackStock` で並べる（材料の手持ちから引かない）。組の手持ちが尽きて置けなかった片は、**組の結果の `unplaced`（`noStock`）** にする。a・b のふつうの片に回さない（14.7 の「組に置けなかった片を a・b に回す」と `Piece.twin` の使い道はなくなる。暫定。未決事項 42）。組が手持ちでなければ今までどおり（入らない片は `tooLarge`）
- 材料のふつうの片：`availableStock` で並べる（組の1枚を引かない）
- 組の結果の `SheetLayout.sheet`（手持ちの1枚の印）・歩留まり・おまかせは、ふつうの材料と同じ
- 固定した組の1枚：`freezeSheet(…, stackWith)` の `grain` は `layout.sheet?.grain ?? stackChoice(job, [a, b]).grain`（今は a の材料の木目）。`frozenDemand`・チェック・切り終わりは 12.5 のまま
- 手持ちを登録しない仕事でも、**組のサイズと材料のサイズが違ってよい**（例：組は 3×6、ラワン 4 の背板は 4×8）。この版で結果が変わるのは「材料のサイズがそろっていなくて重ねていなかった組」と「手持ちを使っていた組」だけ

### 15.5 比較・まとめ・足りないとき（`packing/sizes.ts`・`progress/frozen.ts`・`hints/shortage.ts`）

- `compareStandardSizes`：3×6／4×8 にした写しで、手持ちでない材料に加えて **手持ちでない組の設定も同じサイズにする**（写しの `stackSheets` に、今の組すべての行を 3×6／4×8 で入れる）。`packJob` 2回のまま。今の仕事の `stackPlan` を渡す処理（12.7）は、組がサイズで決まらなくなったので要らない（渡しても同じ）
- （修正）手持ちで木取りする行（材料の行・組の行とも）も、写しでは手持ちを外して 3×6／4×8 にする。どの行でも 3×6／4×8 の本当の枚数・歩留まりを並べるため（仕様書 9）。画面は手持ちの行でも数字を出す
- `materialSummaries`：変えない（組の行は今までどおり）
- `materialSizeCounts`：組の行も、その組の1枚を大きさごとに数える（今もそうなっていれば変えない）
- `stockUsage(job, result)`：組の行も出す（`boardId: stackKey`・`stack: { boardIds }`。組の手持ちの行ごとに 使う（組の固定した1枚＋組の計算した1枚）／残り）。材料の行は、その材料のふつうの1枚だけを数える（組の1枚は数えない）
- `stockShortage`：組の結果に `noStock` の片があれば、組も対象にする（`boardId: stackKey`、`label` は `stackLabel`、`missing` は入らない部材）。足す枚数は今までどおり「足りない行すべてに同じ n 枚の行を足した写し」で試す（組には組の設定に行を足す）。切り代・端切りを小さくして入るかも同じ
- お知らせ（`findSavingHints`）：`noStock` のある組は「減らせる」の対象から外す（材料と同じ）

### 15.6 保存・操作（`src/store`）

**行の操作**（`jobs.ts`）：材料の行と組の行を同じ関数で扱う。

```ts
export type SizeTarget = string /* 材料の id */ | readonly [string, string] /* 組の2つの材料の id */
setRowSize(job, target, size)                 // 3×6／4×8 を選ぶ：大きさと木目を入れ、stockOn を外す（手持ちの行は残す）
setRowStockMode(job, target, on)              // 自由入力を選ぶ：on で stockOn。行が無ければ、今の大きさ ×1 の行を1つ入れる（14.10 の setStockMode と同じ）
addRowStock / updateRowStock / removeRowStock // 14.10 の手持ちの操作と同じ検査。最後の1行を消すと stockOn も外す
```

- 組の行の操作で `stackSheets` にその組の行が無ければ、4×8 の行を作ってから変える（a・b は材料の保存の並び）
- 今の `setBoardSize`・`setStockMode`・`addStockSheet`・`updateStockSheet`・`removeStockSheet` は、材料の id を渡した行の操作と同じもの（名前を残すか置き換えるかは engine-dev に任せる）。**相手の材料をそろえる処理と `setBoardsSize` は消す**
- `removeBoards`：消した材料の入る組の設定を `stackSheets` から消す
- `copyJob`：`stackSheets` の `boardIds` を新しい材料の id につけ替え、手持ちの行も写す（材料の手持ちと同じ）
- ひな形（8.3）には入れない（新しい仕事は `stackSheets: []`。組は 4×8 から始まる）
- 見本（`sampleFromTemplate`）：材料を 3×6 にするのに合わせ、フラッシュ25 の組（メラミン 1＋ラワン 4）の設定も 3×6 で入れる（見本の期待値＝組 3×6 で5枚、を変えないため。未決事項 24 と同じ考え）

**読み込み**（`storage.ts`）
- `stackSheets` があれば検査・修復：配列でなければ `[]`。行ごとに、`boardIds` が仕事にある違う2つの材料で、同じ組（並びを問わず）の行が前に無いこと、サイズ・手持ちは `sanitizeBoard` と同じ検査。だめな行は外して直した数に数える
- **`stackSheets` が無い仕事（第2.2版までのデータ）だけ、1回移し替える**：`stackPlan` の組ごとに1行作る
  - サイズ＝ a の材料の今のサイズ（`sizeKind`・`width`・`length`・`grain`）。今まで重ねていた組は a と b が同じサイズなので「2つの材料の共通のサイズ」になる。そろっていなかった組も a のサイズで重ねるようになる
  - a か b が手持ちを使っていた（`usesStock`）なら、今の `commonStock(stockKinds(a), stockKinds(b))` の行（枚数が有限のもの）を組の手持ちにして `stockOn`。そろう行が無ければ手持ちなし
  - 材料の手持ちの行・枚数はそのまま（組の分を引かない。暫定。未決事項 43）
  - 固定した1枚は変えない（写しなので結果に影響しない）。移し替えたことは直した数に数えない（壊れていたわけではないため）
- 以前の「自由入力」（`stockOn` の無い `custom`）は移し替えない（15.3）

### 15.7 材料を変えたときの厚みの置き換え（`formula/usages.ts`）

仕様書 5.4「部材の材料（またはフラッシュ）を変えたとき、その部材の式に前の材料の厚みが入っていれば、新しい材料の厚みに自動で置き換える」。

```ts
/** 部材1つの W・H・D の式の {t:from} を {t:to} に置き換える。置き換えた軸（W→H→D の順）を返す */
export function swapThicknessRef(expr: Record<Axis, string>, from: string, to: string):
  { expr: Record<Axis, string>; axes: Axis[] }
```

- `from`・`to` は材料の id かフラッシュの id（式の `{t:…}` はどちらも同じ書き方。10.2）。中身は `remapBoardIds(expr, new Map([[from, to]]))`
- 置き換えないとき：前か後の材料が無い（`null`。枚数0の行など）、同じ材料、式に `{t:from}` が無い → `axes: []`
- ほかの部材の式は変えない（渡すのは編集中の部材の式だけ）
- 画面（部材の編集）：材料の欄を変えたら、下書きの式に `swapThicknessRef` をかける。`axes` があれば「W の式のフラッシュ25 をフラッシュ22 に置き換えました」（軸が2つ以上なら「W・H の式の…」。名前は `boardTokenLabel` やフラッシュの名前）と「元に戻す」を出す。元に戻すは、置き換える前の下書きの式に戻す（材料はそのまま）。知らせは、次に材料を変える・式を打つ・保存するまで出しておく。**保存する前の下書きの中の話なので、store の操作は増やさない**

### 15.8 画面（`src/ui`）

| 画面 | 変更 |
|---|---|
| 木取り：まとめ | 材料の行・組の行のそれぞれに、3×6・4×8（比較の枚数・歩留まり）・自由入力 の3つ。選んでいるのは `stockOn` なら自由入力、そうでなければ `sizeKind`（以前の「自由入力」は自由入力。15.3）。3×6・4×8 は `setRowSize`、自由入力は `setRowStockMode(on)` |
| 木取り：手持ち | 自由入力を選んだ行の下に、その行の手持ちの編集（`StockEditor`：行ごとに サイズ 3×6／4×8／自由入力（短辺・長辺・木目）・枚数（数字キー）・「使う ◯／残り ◯」（`stockUsage`）・削除、「手持ちを足す」）。**まとめの下の「手持ちの材料」の段は消す**。手持ちの行があるときのまとめは、今までどおり `bySize`（「4×8 ×2・3×6 ×1」）も出す。以前の「自由入力」（`stockOn` の無い `custom`）の行は、編集の欄に「910×1820（枚数の指定なし）」のように出し、「手持ちを足す」で `setRowStockMode(on)`（その大きさ ×1 の行が入る。未決事項 44） |
| 木取り：組の行 | 材料の行と同じ部品・同じ操作（`SizeTarget` に組の2つの id を渡す）。a・b のどちらが手持ちでも、組のサイズの選択は出す |
| 木取り：知らせ | サイズがそろっていない組の知らせ（12.8・14.11）を消す。足りない知らせ（14.11）は組の行も「メラミン1＋ラワン4（重ね切り）が足りません（入らない部材：棚板）」 |
| 部材の編集 | 材料の欄を変えたときの置き換えの知らせと「元に戻す」（15.7。押す所は 44px 以上） |

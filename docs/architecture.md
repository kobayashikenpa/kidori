# kidori 設計（第1版・第1.1版）

仕様の正は `docs/spec.md`。この文書は「どこに何を作るか」「データの形」「計算の流れ」を決める。
仕様書に書いていないことで、ここで仮に決めたものには **（暫定）** を付け、`docs/tasks.md` 末尾の未決事項に挙げている。
計画係（planner）が決めたものには **決定（planner）** を付けている。

> **第1.1版の変更は 6章にまとめている。** 1〜5章と 6章が食い違うところは 6章が正（例：部材ごとの逃げ `Part.clearance` は第1.1版でなくなる）。

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
      DimensionCard.tsx    寸法表の部材カード
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
  trim: number        // 端切り（耳落とし。初期値 5）。刃厚を含む。縦切り優先は右の長手、横切り優先は上の長手と右の妻手
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
5. 木取り寸法 = 仕上がり ＋ 切り代（面の2軸それぞれに1回足す）。切り代は `part.allowance ?? settings.allowance`（0 も有効な値）

### 3.3 木取り（`packing/`）

**板の置き方**：切り方で変わる。どちらも左下が原点、y は上が +（配置図の上＝奥）。端切りの幅は刃厚を含む。
- 縦切り優先：縦長（`portrait`）。x = 短辺方向（0〜width）、y = 長辺方向（0〜length）。端切りは右の長手：使える範囲は `x: 0〜(width − trim)`、`y: 0〜length`
- 横切り優先：横長（`landscape`、妻手が右）。x = 長辺方向（0〜length）、y = 短辺方向（0〜width）。端切りは上の長手 → 右の妻手の順（右上の角の矩を出す）：使える範囲は `x: 0〜(length − trim)`、`y: 0〜(width − trim)`（サブロク・端切り5 なら 1815×905）
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
1. 端切り：縦切り優先は右の長手（縦に切る）。横切り優先は上の長手（横に切る）→ 右の妻手（縦に切る）
2. 右の帯から順に、帯を切り離す（縦に切る）
3. その帯を、上から片ごとに切り分ける（横に切る）
4. 帯より細い片は幅を切り揃える（縦に切る）
- 縦・横は配置図の上で見た向き（横長の図でも、図の縦の線は「縦に切る」）
- ラベルの位置は、その時点で残っている板（切る範囲 `within`）の端から測る（決定：未決事項11）
  - 縦に切る：「右端から ◯mm」、横に切る：「上端から ◯mm」（どちらの切り方でも）
  - 刃厚は測った側の反対側（余りの側）で消える：縦は線の左、横は線の下。端切りは刃厚を含む
  - 例（見本 1枚目・縦切り優先）：1 端切り（x=905）→ 2 右端から 410mm で縦（x=495）→ 3 上端から 1810mm で横（y=10）→ 4 右端から 410mm で縦（x=82）→ 5 上端から 1810mm で横（y=10）
  - 例（見本 1枚目・横切り優先）：1 端切り：上の長手（y=905）→ 2 端切り：右の妻手（x=1815）→ 3 右端から 1810mm で縦（x=5）→ 4 上端から 410mm で横（y=495）→ 5 上端から 410mm で横（y=82）

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
  - `addBoard / updateBoard / removeBoard`：材料名＋厚みの重複は拒否。`partsUsingBoard(job, boardId)` で使っている部材名を返し、画面で確認してから削除。削除したら該当部材の `boardId` は null
- id は `crypto.randomUUID()`

## 5. 画面（`src/ui`）

幅 375px 前後、横スクロールなし、押せる部分は高さ 44px 以上、ライト／ダーク両対応。下に5つのタブ：**仕事・部材・寸法表・木取り・設定**。仕事を開いていないときは「仕事」以外を押せない。

| 画面 | 内容 |
|---|---|
| 仕事 | 保存した仕事の一覧（名前・更新日）。新しく作る・開く |
| 部材 | 部材カードの一覧（名前・板・枚数・W×H×D・エラー表示）。押すと編集シート。追加ボタン |
| 部材の編集 | 名前、板（材料名＋厚みから選ぶ）、W・H・D（式の入力）、厚みの寸法（自動／W／H／D）、枚数、木目（面の2軸＋どちらでもよい）、逃げ（面の2軸それぞれ）、切り代（空欄＝初期値） |
| 式の入力 | 入力欄の下に、登録済みの部材の寸法ボタン（`全体.W` など。編集中の部材自身は出さない）、`+ − × ÷ ( )`、数字・小数点・1字消す。キーボードでも打てる。エラーは欄のすぐ下に日本語で |
| 寸法表 | 部材ごとのカード。**仕上がり寸法** と **木取り寸法** を別の段に分け、見出し・色（例：仕上がり＝青系、木取り＝橙系）・並び（仕上がり → 木取り）で区別。枚数、厚みの寸法、厚み不一致の注意 |
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
  - `defaultBoards(newId)`：メラミン 1、ラワン 2.5、ラワン 4、ラワン 5.5（すべて 3×6 910×1820、木目 長手方向）。id は `newId('board')`
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

`migrateClearance(job: LegacyJob, makeId: () => string): Job`（`LegacyJob` は `clearance` を持つ古い形。この関数の中だけで使う。engine は store の `newId` を import しないので、id の作り方は引数で受け取る）
1. 設定に `nige` が無ければ `defaultNige()` を入れる
2. 各部材の逃げのうち値が 0 より大きい軸について、同じ値（小数第1位で比較）の逃げが設定に無ければ足す（id は `makeId()`、値の小さい順に足す）
3. どの軸に引くか：以前の計算と同じく **厚みの寸法の軸には引かない**。厚みの軸は、逃げをすべて外した仕事を新しい `computeDimensions` で計算して決める（手で選んだ軸はそれ、自動なら板の厚みと同じ値の軸。決まらなければ3軸とも引く＝以前と同じ）
4. 式の書き換え：式が数値1つか部材の参照1つなら `元の式 - {n:id}`、それ以外は `(元の式) - {n:id}`。元の式が空ならそのまま（エラーのまま）
5. `memo: ''`、`checks: { finished: false, cut: false }` を足す
- 同じ仕事を2回移し替えても結果が変わらない（`clearance` が無い部材は何もしない）
- 注意：ほかの部材の逃げによって自分の厚みの判定が変わる、というまれな場合だけ、以前の版と厚みの軸が変わりうる（テストで想定しない）

### 6.6 保存データ第2版（`storage.ts`）— 決定（planner）

- 新しいキー `kidori.jobs.v2` に `{ version: 2, jobs: Job[] }` で書く。`kidori.currentJobId` はそのまま
- 読み込み
  1. `kidori.jobs.v2` があればそれを読む（第2版の形で検査・修復）
  2. 無くて `kidori.jobs.v1`（version 1）があれば、第1版の形で検査・修復したあと `migrateClearance` で移し替える。結果は次の保存で v2 に書く
  3. **`kidori.jobs.v1` は消さず、書き換えもしない**（移し替えがうまくいかなかったときの控え）
- 第2版の検査・修復で足すもの
  - `settings.nige`：配列でなければ `defaultNige()`。id が空・重複、値が 0 以下・数でない、値が前の逃げと同じ、のものは外す（外したら直した数に数える）
  - `part.memo`：文字列でなければ `''`
  - `part.checks`：`finished`・`cut` が真偽値でなければ false
  - `part.clearance` が残っていても読み捨てずに、`migrateClearance` を通す（v2 に古い形が混ざっても値が変わらないように）
- 退避のキーは第2版用に `kidori.jobs.v2.broken…` を使う

### 6.7 材料を減らせるときのお知らせ（`hints/saving.ts`）— 決定（planner）

`findSavingHints(job): SavingHint[]`。計算を軽くするため、試すのは次の候補だけ（1つずつ変える。組み合わせは試さない）
- **切り代**：`0・5・10` のうち、今の仕事の切り代より小さい値（例：10 なら 5 と 0）。変えるのは仕事の切り代だけで、部材ごとの上書き（例：背板 0）はそのまま
- **端切り**：今の端切りが 0 より大きければ `0`
- 切り方・刃厚は今の設定のまま（おまかせならおまかせで）

各候補で `computeDimensions` → `packJob` をやり直し（最大3回）、材料ごとに必要枚数を今と比べる
- 必要枚数が減り、かつ入らない部材が増えない材料を「減る」とする
- 候補ごとに1つのお知らせにまとめる。減る材料が無い候補は出さない
- 切り代 0 のお知らせは、切り代 5 のお知らせと減る材料・枚数がまったく同じなら出さない（小さく変えるほうだけ見せる）
- 並び：切り代（大きい値から）→ 端切り

```ts
export interface SavingHint {
  change: { kind: 'allowance' | 'trim'; value: number }
  materials: { boardId: string; label: string; from: number; to: number }[] // label は「ラワン 4mm」
  message: string
}
```

- 文言：`切り代を 5mm にすると、ラワン 4mm が 1 枚減ります（3枚 → 2枚）`。材料が複数なら `、` でつなぐ：`端切りを 0mm にすると、シナランバー 18mm が 1 枚（3枚 → 2枚）、ラワン 4mm が 1 枚（2枚 → 1枚）減ります`
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

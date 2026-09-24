# kidori 設計（第1版）

仕様の正は `docs/spec.md`。この文書は「どこに何を作るか」「データの形」「計算の流れ」を決める。
仕様書に書いていないことで、ここで仮に決めたものには **（暫定）** を付け、`docs/tasks.md` 末尾の未決事項に挙げている。

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
  trim: number        // 耳落とし（初期値 5）。縦長に置いた板の右側の長辺だけ
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

/** 板の上の長方形。板を縦長に置き、左下を原点とする。x は短辺方向（右が +）、y は長辺方向（上が +） */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Placement extends Rect {
  pieceId: string     // `${partId}#${連番}`
  partId: string
  name: string
  rotated: boolean    // 部材の face[0] を y 方向（長辺方向）に置いたとき false
  sizeLabel: string   // 配置図に出す寸法（例："1810×410"）
}

export type CutDirection = 'vertical' | 'horizontal' // 縦に切る（長辺と平行）/ 横に切る（短辺と平行）

export interface CutStep {
  no: number              // 1 から
  direction: CutDirection
  /** 切る線の位置：vertical なら x、horizontal なら y */
  at: number
  /** 切る範囲（この長方形を2つに分ける） */
  within: Rect
  kind: 'trim' | 'strip' | 'crosscut' | 'rip' // 耳落とし / 帯を切る / 帯を切り分ける / 幅を切り揃える
  label: string           // 画面用の日本語（例：「右端から 410mm で縦に切る」）
}

export interface SheetLayout {
  index: number           // その材料の何枚目か（1 から）
  boardWidth: number      // 短辺
  boardLength: number     // 長辺
  usable: Rect            // 耳落とし後に使える範囲
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
  skipped: { partId: string; name: string; reason: 'dimensionError' | 'noBoard' }[]
}
```

- 初期値は `DEFAULT_SETTINGS = { kerf: 3, trim: 5, allowance: 10, cutMode: 'vertical' }`、板サイズは `BOARD_SIZES = { saburoku: [910, 1820], shihachi: [1220, 2440] }` として同じファイルに置く

## 3. 計算の流れ

### 3.1 式（`formula/`）

- 字句：数値（小数可）、参照 `部材名.W|H|D`、`+ - * / ( )`、空白。画面のボタンの `×` `÷` は入力時に `*` `/` に置き換えて式に入れる
- 入力の揺れをそろえる（`normalizeFormulaText`）：字句に分ける前に、NFKC で全角の数字・記号・英字を半角にし（`９００` `＋` `（` `．` `Ｗ` など）、`×` `✕` → `*`、`÷` → `/`、`−` `–` `—` → `-` に置き換える。長音の `ー` は置き換えない。字句の位置（エラーの位置）は入力したままの文字の位置で返す
- 部材名は `normalizePartName`（同じ NFKC）でそろえてから参照と照らし合わせる。全角・半角の違いだけの名前は重複とみなし、全角の記号（`＋` `×` など）を含む名前も使えない
- 参照の読み取り（暫定）：「`.` の直後が W・H・D」の並びを参照とみなし、その前の、記号・空白・括弧を含まない最長の文字列を部材名とする。数字で始まる部材名は数値と区別できないため、未決事項に挙げる
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

**板の置き方**：縦長に置く。x = 短辺方向（0〜width）、y = 長辺方向（0〜length）。
耳落としは右側の長辺：使える範囲は `x: 0〜(width − trim)`、`y: 0〜length`。

**片の展開と向き**（`pieces.ts`）
- `quantity ≥ 1` かつ寸法にエラーがなく板のある部材を、1枚ずつの片にする。`boardId` ごとに分ける
- 片の縦（y）と横（x）の決め方：板の木目が長辺方向なら、部材の木目の軸の木取り寸法を y に置く。短辺方向なら x に置く。`any` は回転してよい（配置時に両方試す）
- どう回しても使える範囲に入らない片は `unplaced`

**刃厚込みの入り判定**（`sheet.ts`）
- 長さ L の中に片 s1…sn を並べる条件：`Σs + kerf × (n − 1) ≤ L`（最後の片の外側は端材側に刃厚を負担させる）（暫定）

**帯詰め**（`guillotine.ts`）— 縦切り優先
1. 片を「帯の幅（x 方向）の大きい順 → 長さ（y 方向）の大きい順」に並べる
2. 1片ずつ、開いている板の帯を先頭から見て、**幅が収まり、残りの長さに刃厚込みで入る最初の帯** に置く（First Fit）
3. 入る帯がなければ、今の板の残り幅（左側）に新しい帯を作る。帯の幅は最初に置いた片の幅
4. 板の残り幅にも入らなければ、新しい板を出す
5. **右から詰める**：最初の帯は使える範囲の右端（x = width − trim）に接して置き、次の帯はその左に刃厚をあけて置く。余りは左側に残る
6. 帯の中では片を y = 0 から順に重ねる（暫定）。帯より細い片は、帯の右端に寄せ、左の余りは端材にする

横切り優先は、同じ処理を「帯＝短辺方向の横長の帯（高さ＝y 方向）」として行う。帯は y = 0 から積み、帯の中の片は右から詰める。実装は縦と横で x・y を入れ替えた共通の関数にする。

**計算量**：片 n 枚・帯 m 本で O(n × m)。100枚超でも一瞬で終わる。

**おまかせ**（`index.ts`）：縦切り優先・横切り優先の両方を材料ごとに計算し、歩留まりの良いほうを採る。同じなら縦切り優先（暫定。枚数が同じだと歩留まりも同じになる点は未決事項）

**切る順番**（`cutOrder.ts`）：板ごとに次の順で並べる
1. 耳落とし（縦に切る）
2. 右の帯から順に、帯を切り離す（縦切り優先なら縦、横切り優先なら横）
3. その帯を、片ごとに切り分ける（帯と直角の向き）
4. 帯より細い片は幅を切り揃える
- ラベルの位置は「右端から ◯mm」（縦に切る）、「下端から ◯mm」（横に切る）で表す（暫定）

**端材**（`scraps.ts`）：板の左側の残り、各帯の残り長さ、帯より細い片の横の残りを長方形で返す。刃厚ぶんは差し引いた大きさ。幅か長さが刃厚以下のものは出さない（暫定）

**歩留まり**（`yield.ts`）
- 板1枚：置いた片の木取り寸法の面積の合計 ÷ 板全体の面積（耳落とし前、width × length）（暫定）
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

**配置図**（`SheetDiagram.tsx`）：`viewBox` を板の寸法（mm）にして画面幅に合わせる。耳落としの帯・部材（名前と寸法）・端材を色分け。y は上が + なので描くときに反転する。

# kidori 設計（第1版・第1.1版・第1.2版・第1.3版）

仕様の正は `docs/spec.md`。この文書は「どこに何を作るか」「データの形」「計算の流れ」を決める。
仕様書に書いていないことで、ここで仮に決めたものには **（暫定）** を付け、`docs/tasks.md` 末尾の未決事項に挙げている。
計画係（planner）が決めたものには **決定（planner）** を付けている。

> **第1.1版の変更は 6章にまとめている。** 1〜5章と 6章が食い違うところは 6章が正（例：部材ごとの逃げ `Part.clearance` は第1.1版でなくなる）。
> **第1.2版の変更は 7章にまとめている。** 6章までと食い違うところは 7章が正。
> **第1.3版の変更は 8章にまとめている。** 7章までと食い違うところは 8章が正。

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
  screens/JobsScreen.tsx       新しい仕事・見本をひな形から作る
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

### 8.4 見本（本棚 W900）をひな形から作る — 決定（planner）

`sampleFromTemplate(template, now): Job`（`src/store/sample.ts`）。`bookshelfJob()`（engine の見本。テストで使う）は変えない。
1. `createJob('本棚 W900', template, now, 'job-bookshelf-w900')` で作る（見本の id は今のまま固定。仕事の画面の「見本があるか」の判定に使う）
2. 見本の材料 シナランバー 18・シナベニヤ 4 について、同じ材料名（前後の空白を除き NFKC でそろえて比べる）＋厚み（`eq1`）の材料があればそれを使い、無ければ材料の最後に足す（印なし＝足した材料として上に並ぶ）
3. 見本の部材は `bookshelfJob().parts` を写し、`boardId` を 2 の材料の id につけ替える
4. 見本の材料のサイズ：**3×6（サブロク）にする**（暫定。未決事項 24）。見本で期待する値（tasks.md の表：ランバー 3枚など）は 3×6 の値のため。すでにあった材料を使うときも、この仕事の中ではその材料を 3×6 にする
5. 逃げ：棚板の式は `{n:nige-1}` を使う。ひな形の逃げに **寸法 1 の逃げがあればその id につけ替え、無ければ 逃げ1 を足す**（id `nige-1`。すでに別の逃げが `nige-1` を使っていれば `newId('nige')`）（暫定。未決事項 25）
- 設定の数値（刃厚・端切り・切り代・切り方）はひな形のまま。見本で期待する値は、ひな形が初期値のときの値

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
explainDimension(job, partId, axis): DimensionExplanation
```

- 式を左から順に、記号・数・参照（部材の寸法・材料の厚み・調整寸法。表示名と値）の並びにして、計算結果と一緒に返す。例：天地板.W → `全体.W 900 − 側板.W 18 × 2 = 864`
- 値は `computeDimensions` と同じ計算（仕上がり寸法）。式や参照先にエラーがあれば `result` は null で、その寸法のエラーを返す

### 9.3 厚みの寸法の自動表示（`dimensions/thickness.ts`）

```ts
thicknessChoice(part, board, finished): { autoAxis; ambiguous; showSelector }
```

- `autoAxis`：自動で選ぶ軸（手で選んだ軸は見ない。W→H→D で材料の厚みと同じ最初の軸）。`ambiguous`：材料の厚みと同じ値の軸が2つ以上。`showSelector`：`ambiguous` か、手で選んだ軸があるとき
- 画面は `showSelector` が false なら「厚み：W（自動）」と表示だけにする

# kidori（木取り計算システム）

家具屋で使う、板材から部材を歩留まり良く切り出すための木取り計算 Web アプリ。スマホ（iPhone / Android）で使う。

- **仕様の正は `docs/spec.md`**。実装で迷ったら仕様書に従い、仕様書に書いていないことは勝手に決めずに進行役（メインの Claude）に報告する
- 作業の一覧は `docs/tasks.md`、設計は `docs/architecture.md`
- `docs/mockup/index.html` は画面の試作（参考のみ）。ロジックは流用せず、仕様書から作り直す

## 利用者について

- 利用者（オーナー）は Git も Claude も初心者。報告は日本語で、専門用語には短い説明を添える
- 家具づくりの現場の言葉を使う：部材、板、仕上がり寸法、木取り寸法、逃げ、切り代、刃厚、耳落とし、歩留まり

## 技術

- React + TypeScript（strict）+ Vite、テストは Vitest、リントは oxlint
- 公開先は GitHub Pages（`https://kobayashikenpa.github.io/kidori/`）。`vite.config.ts` の `base` は `/kidori/`
- Node.js / npm / gh は `~/.local/bin` にある。PATH に無ければ `export PATH="$HOME/.local/bin:$PATH"` を先に実行する

## コマンド

| 目的 | コマンド |
|---|---|
| 全チェック（型・リント・テスト） | `npm run check` |
| テストだけ | `npm test` |
| 開発サーバー | `npm run dev` |
| 本番ビルド | `npm run build` |

## 構成

```
src/
  engine/   計算ロジック（React に依存しない純粋な TypeScript）
            式の解析・寸法計算・木取り（配置）計算。テストは同じ場所に *.test.ts
  ui/       画面（React コンポーネント）
  store/    状態管理と保存（localStorage）
docs/
  spec.md          仕様書
  architecture.md  設計
  tasks.md         作業の一覧（進捗もここで管理）
```

- `src/engine` は `src/ui` や React を import しない（計算と画面を分けて、計算だけでテストできるようにする）
- 寸法は mm 単位の number。表示時に小数第1位まで

## ルール

- 用語・画面の文言は日本語。寸法の軸は **W（幅）・H（高さ）・D（奥行き）**。「縦・横」は板の向きの説明にだけ使う
- 計算ロジックはテストを先に書く。仕様書の例（本棚 W900 など）をテストケースに使う
- 完了の条件：`npm run check` が通ること。通らないまま「完了」と報告しない
- 1つの作業ごとにコミットする。コミットメッセージは日本語で、何をしたかが分かるように書く
- `main` へ直接コミットしない。ブランチ → PR → オーナーがマージ
- 依存パッケージを増やすときは、理由を報告に書く

## 開発の流れ（ハーネス）

進行役（メインの Claude）が、`.claude/agents/` のサブエージェントに作業を割り振る。

1. **planner**：仕様書から作業を分けて `docs/tasks.md` を更新する
2. **engine-dev**：`src/engine` の計算ロジックをテスト駆動で作る
3. **ui-dev**：`src/ui`・`src/store` のスマホ画面を作る
4. **verifier**：`npm run check` と、仕様書の各項目どおりに動くかを確かめる
5. **reviewer**：差分を仕様書・このファイルのルールと照らしてレビューする

進行役は結果をまとめてオーナーに報告し、PR を作る。

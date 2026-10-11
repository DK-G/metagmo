# メタグモ (metagmo) モノレポ概要

メタグモは、Wikipediaのように「事実（ファクト）」を集積するページを土台に、誰でもタグで主観を可視化できるSNSを構築するプロジェクトです。ユーザーは視界（フィルタ）を切り替え、ものの見え方の差分を体験できます。このリポジトリは、Cloudflare Workers と D1 の上に載る npm workspaces のモノレポです。Worker が API とページの両方を返します。

## リポジトリ構成
- `apps/worker/`: 本体の Cloudflare Worker（TypeScript）。`migrations/` に D1 の表、`test/` に手元の D1 で動くテスト。
- `docs/`: 詳細仕様、計画ドキュメント (`metagmo_spec.md`など)。
- `scripts/`: リポジトリユーティリティ。
- `GEMINI.md`, `RoadMap.md`, `task.md`: 開発計画と日々のタスク管理用ドキュメント。

## 技術スタック
- **土台:** Cloudflare Workers + D1（TypeScript）。決定の経緯と見直す条件は `spec.md` §7。
- **画面:** Worker がページの HTML を返します。
- **モノレポ管理:** npm workspaces
- **テスト:** vitest + `@cloudflare/vitest-plugin`（手元の D1）
- **ログイン:** MVP にはありません。導入を決めた時に土台を見直します。

## 必須環境
- Node.js 18 以上。
- npm 10 以上（workspaces 利用。`package.json` の `packageManager` は `npm@10.8.2`）。

## 初期セットアップ
1. 依存関係を一括インストール: `npm install`
2. テスト: `npm test`（手元の D1 に `apps/worker/migrations/` を当てて実行します。鍵や環境変数は要りません）
3. Worker を手元で起動: `npm --workspace apps/worker run dev`

## 開発時によく使うコマンド
- テスト: `npm test`
- 型検査: `npm run typecheck`
- リント: `npm run lint`（`apps/worker` が対象）

## 進め方
- プロジェクトの全体像と目的は `GEMINI.md` を参照してください。
- 長期計画は `RoadMap.md`、日々の作業は `task.md` にて管理します。
- `task.md` には、RoadMap ID（例: `R1-1`）を見出しとして記録し、細分化したチェックボックスで管理します。

## コミットと PR 方針
- Conventional Commits (`type(scope?): summary`) を採用。
- 1 コミット 1 トピックを心がけ、関連タスク番号をメッセージや PR 説明に記載。
- コード変更時は `npm run lint` と必要なテストを実行し、結果を控えておく。

## 参考ドキュメント
- `metagmo_spec.md`: メタグモの全体仕様書。
- `GEMINI.md`: Gemini CLIとの対話のためのプロジェクト概要と開発方針。
- `RoadMap.md`: バージョン別タスク一覧。
- `task.md`: 進行中の詳細タスクとログ。
- `docs/` 配下の仕様書: 各機能の詳細仕様など。

## ライセンス
- 利用ライブラリのライセンスおよびクレジットは `docs/` に追記予定です。
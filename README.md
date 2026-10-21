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

## 一覧APIの検索・並び替え

- `GET /api/entities?q=東京&sort=newest`: タイトルまたはタグの部分一致でページを検索（同じページは1件）。既定は新着順。
- `GET /api/entities?sort=score_desc`: ページの全タグの up − down の合計順。票のないページは0。
- `GET /api/entities/:id/tags?q=東京&sort=newest`: タグ文言の部分一致。既定は `score_desc`。`recent`・`consensus`・`controversy` と併用可能で、スコアは視界内の票から計算。
- `q` は前後の空白を除き最大200文字。空なら全件。`%`・`_` も文字として扱う。ASCIIの大文字小文字は区別しない。並びは `score_desc` / `newest` のみ、同点は作成日時の降順・id順。ページの上限100件は検索と並び替えの後で適用。

## 書き込みの荒らし対策（Q-007）

- 書き込み（`POST` のページ・ファクト・タグ・投票）は、接続元 IP（`CF-Connecting-IP`）ごとの流量制限と Cloudflare Turnstile を通ってから受けます。実装は `apps/worker/src/guard.ts`。
- 流量: 10 分の固定窓で、投稿（ページ・ファクト・タグの合計）20 件・投票 60 票まで。超えると `429`（`Retry-After` つき）。回数は D1 の `rate_limits` 表（`migrations/0003`）。検証に落ちた試行も数えます。
- Turnstile: ウィジェットのトークンを `X-Turnstile-Token` ヘッダーで送ります。無い・落ちたら `403`。秘密鍵 `TURNSTILE_SECRET_KEY` が無い時は書き込みを止めます（`503`）。
- 公開時: `wrangler secret put TURNSTILE_SECRET_KEY` で鍵を入れます（鍵はリポジトリに置かない）。手元の `wrangler dev` で書き込むには `.dev.vars`（gitignore 済み）に Cloudflare の試験用の鍵を書きます。
- テストは外へ通信しません（`vitest.config.ts` の `outboundService` が siteverify の代役をします）。

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

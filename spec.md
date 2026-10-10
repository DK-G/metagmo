# spec.md

> このファイルはAI向けの開発仕様書。READMEとは別物。  
> 新しいセッション開始時はこのファイルを最初に読み込ませること。

-----

## 1. コンセプト

- **概要**: 「事実（ファクト）」ページを土台に、誰でもタグで主観を可視化できるSNS（**メタグモ / metagmo**）。ユーザーは「視界（フィルタ）」を切り替え、ものの見え方の差分を体験できる。Wikipedia的なファクト蓄積ページにソーシャルタグ層を重ねた構造。
- **設計思想 / 譲れない核**: ファクトは中立・客観。タグは主観。この分離を絶対に崩さない。Leverage スコア計算は仕様書（`metagmo_spec.md` §4）の公式を厳守する。視界切り替え（`flat` / `registered_only` / `leverage`）がコア体験。
- **ターゲットユーザー**: 情報の見え方の差分に関心があるユーザー（第一に作者自身）。
- **現在のフェーズ**: MVP実装中。詳細仕様は [`metagmo_spec.md`](metagmo_spec.md) を参照。フェーズは [`RoadMap.md`](RoadMap.md)、タスクは [`task.md`](task.md) を参照。

-----

## 2. 技術スタック

| 領域 | 採用技術 | バージョン | 選定理由 |
|---|---|---|---|
| 土台 | Cloudflare Workers + D1（TypeScript） | wrangler 4.x | §7 の決定（2026-10-10） |
| 画面 | Worker がページの HTML を返す | - | 各ページを検索結果と X のカードに載せるため |
| モノレポ管理 | npm workspaces | 10.x | パッケージ間依存管理 |
| テスト | vitest + `@cloudflare/vitest-pool-workers` | 4.x | 手元の D1 で表と読み書きを確かめる |
| ログイン | MVP には無い | - | 導入を決めた時に土台を見直す（§7） |

-----

## 3. アーキテクチャ

### ディレクトリ構成

```
/apps
  /worker/          # Cloudflare Worker + D1（API とページ）。表は migrations/、テストは test/
  /web/             # 旧計画の雛形。使わない
/packages
  /ui-components/   # 共有UIコンポーネント
  /utils/           # 共通ユーティリティ
  /types/           # 共有型定義
/docs
  metagmo_spec.md  # 全体仕様書（★最重要。設計の正本）
```

### データモデル（主要テーブル）

```
entities   — ページ（中立・ファクトベースの記事）
facts      — ファクト（要ソースURL・承認フロー付き）
tags       — タグ（主観的ラベル・最大64文字）
votes      — タグへの up/down 投票
history    — 変更履歴
follows    — ユーザーフォロー関係（発展形。MVP の D1 には作っていない）
```

表の正本は `apps/worker/migrations/`。MVP はログインなしなので、利用者を指す列は任意。

### Leverage スコア計算

```
flat          — 全投票の素合算
registered_only — 登録ユーザーの投票のみ集計
leverage      — フォロー中ユーザーの重み付き合算（-3〜+3スライダー）
              ★ 公式は metagmo_spec.md §4 に従い厳守
```

-----

## 4. 制約・禁止事項 ★最重要

- **Leverage 公式の厳守**: `metagmo_spec.md` §4 のスコア計算公式を勝手に変更しない。変更する場合は仕様書を先に更新する。
- **ファクト/タグの分離維持**: ファクトは中立・ソース必須。タグは主観ラベル。この設計原則を崩さない。
- **スコアリングクエリのテスト必須**: `flat` / `registered_only` / `leverage` の各スコアリングクエリに対してテストを書く。
- **重いDB Joinの禁止**: パフォーマンス問題を防ぐため、重い JOIN は避けマテリアライズドビューを検討する。
- **アンチアビューズ措置の維持**: 匿名ユーザーの投稿に30秒クールダウン、匿名投票にCAPTCHAを維持する。
- **モデレーション機能の維持**: 通報一定数での自動非表示とモデレーター確認フローを崩さない。

-----

## 5. 命名・コーディング規約

- **言語**: TypeScript。
- **DB**: D1（SQLite）。テーブル名はスネークケース。id は UUID の文字列、日時は ISO 8601（UTC）の文字列。表を変える時は適用済みの migration を書き換えず、番号を足す。
- **コミット**: Conventional Commits（`type(scope?): summary`）。1コミット1トピック。
- **コマンド**:
  - `npm test` — テスト（手元の D1）
  - `npm run typecheck` — 型検査
  - `npm run lint` — リント（今は `apps/web` だけが対象）
  - `npm --workspace apps/worker run dev` — Worker を手元で起動
  - フォーマットのコマンドは未定義

-----

## 6. 既知の落とし穴

- **Leverage スコアの整合性**: フォロー関係・重み・投票の三者が絡むため、クエリの正しさをテストで担保しないと気づかずにバグが混入する。
- **匿名ユーザーの識別**: ログインが無いので、投票・投稿の流量制限は IP で行う。Workers では接続元の IP を `CF-Connecting-IP` ヘッダーから読む。
- **互換日付**: `apps/worker/wrangler.jsonc` の `compatibility_date` は、テストの実行環境（同梱の workerd）が対応する日付より先にできない。先にするとテストが起動しない。
- **ファクト承認フロー**: `facts.status = 'pending_review'` のファクトは公開されないことを UI とクエリの両方で担保する。

-----

## 7. 決定ログ

- `2026-10-10` **土台を Cloudflare（Workers + D1）にする。画面は Worker がページを返す**（決めた人: Kira）。それまでの Supabase + Vercel + Next.js の計画から変えた。
  - 理由: ① MVP はログインなしで、DB の差が出ない。② 加入済みの枠で追加費用がかからない。③ 手元の DB がファイル 1 つで、無人の夜の開発に向く。④ EX将棋・koukin・salon-sites と公開の手順が同じ。⑤ 各ページを検索結果と X のカードに載せるには、Worker が HTML を返す形が素直。
  - 見直す条件: **ログインの導入を決めた時。** 発展形（ログイン・`registered_only`・重み付きの視界）は認証と利用者の表を要するので、その時に土台ごと見直す。
  - 旧計画の PostgreSQL 用スキーマ（`follows` を含む）は git 履歴の `docs/db-schema.sql`（commit `a2ebf6f` まで）にある。

-----

## 8. 未解決 / TODO（仕様レベル）

- History テーブルのスキーマ詳細設計（変更種別・スナップショット範囲）
- Leverage ビューのマテリアライズドビュー更新タイミング設計
- モデレーター権限管理（誰がモデレーターか）の設計
- E2EテストツールとしてPlaywrightの採用可否判断
- 多言語対応（Phase 1は日本語のみ）


## 検証ツール (Validation Tools)

現在のプロジェクトで実装・導入されている検証ツールは以下の通りです：

- ESLint
- TypeScript

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
| フレームワーク | Next.js (App Router) + TypeScript | - | SSR・API統合・Vercelデプロイとの親和性 |
| バックエンド | Supabase (PostgreSQL + Auth) | - | Auth・DB・RLSを一体管理 |
| デプロイ | Vercel | - | Next.jsとの相性 |
| モノレポ管理 | Yarn Workspaces | 1.x | パッケージ間依存管理 |
| スタイル | Tailwind CSS | - | - |
| テスト | Jest / React Testing Library | - | Playwright (E2E検討中) |

-----

## 3. アーキテクチャ

### ディレクトリ構成

```
/apps
  /web/             # Next.js クライアントアプリ
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
follows    — ユーザーフォロー関係
history    — 変更履歴
```

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

- **言語**: TypeScript（Next.js App Router標準）。
- **DB**: PostgreSQL（Supabase）。テーブル名はスネークケース。
- **コミット**: Conventional Commits（`type(scope?): summary`）。1コミット1トピック。
- **コマンド**:
  - `yarn dev` — 開発サーバー
  - `yarn build` — ビルド
  - `yarn lint` — リント
  - `yarn fmt` / `yarn fmt:check` — フォーマット
  - `yarn test` — テスト

-----

## 6. 既知の落とし穴

- **Leverage スコアの整合性**: フォロー関係・重み・投票の三者が絡むため、クエリの正しさをテストで担保しないと気づかずにバグが混入する。
- **匿名ユーザーの識別**: Supabase Auth の session がない状態での投票・投稿に対してIPベースのクールダウンを実装する必要があるが、IPの取得方法はエッジ環境（Vercel）で注意が必要。
- **ファクト承認フロー**: `facts.status = 'pending_review'` のファクトは公開されないことを UI とクエリの両方で担保する。

-----

## 7. 決定ログ

- `2026-xx-xx` **Supabase + Vercel 構成を採用**: PostgreSQL + Auth の一体管理とVercel Nextとの相性から選定。

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

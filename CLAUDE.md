@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

メタグモ（Meta-Gumo）は、Wikipediaのように「事実（ファクト）」を集積するページを土台に、誰でも**タグ**で主観を可視化できるSNSプラットフォーム。ユーザーは**視界（View）**を切り替えて、ものの見え方の差分を体験できる。

### コアコンセプト
- **ページ（Entity）**：対象（人物・作品・概念など）の中立ページ
- **ファクト（Fact）**：出典必須の検証可能な事実。価値判断禁止。`pending_review` / `approved` / `rejected` ステータスで管理
- **タグ（Tag）**：自由入力の主観表現（最大64文字）。up/down投票可
- **視界（View）**：タグスコアの集計方法を切り替える機能
  - `flat`：匿名・登録区別なし（`score = up - down`）
  - `registered_only`：登録ユーザーの投稿・投票のみ集計
  - `leverage`：フォローユーザーへの重み設定（−3〜+3）で加重集計
- **レバレッジ（Leverage）**：フォロー関係に重みを付ける仕組み。重み変換式：`weight_u(voter) = clamp(1 + w/3, 0, 2)`

## コマンド

```bash
# 依存関係インストール
yarn install

# 開発サーバー起動
yarn dev

# ビルド
yarn build

# リント
yarn lint
```

テストや `fmt` / `fmt:check` はまだ `package.json` に定義されていないが、仕様では Jest + React Testing Library を使用予定。追加時は `yarn test` で実行する。

## アーキテクチャ

### モノレポ構成（Yarn Workspaces）

```
apps/web/          # Next.js (App Router, TypeScript) — メインアプリ
packages/types/    # 共有型定義
packages/ui-components/  # 共有UIコンポーネント
packages/utils/    # 共通ユーティリティ
docs/              # 仕様書・DBスキーマ
```

### 技術スタック
- **フロントエンド**: Next.js App Router + TypeScript
- **バックエンド**: Supabase (PostgreSQL + Auth)
- **デプロイ**: Vercel
- **スタイル**: Tailwind CSS（導入予定）

### DBスキーマ（`docs/db-schema.sql`）

主要テーブルと関係：
- `entities` → `facts`（1対多）、`tags`（1対多）
- `tags` → `votes`（1対多）
- `auth.users` → `follows`（多対多、`weight` INTEGER −3〜+3 付き）
- `history`：ユーザーアクションの監査ログ（`target_type` + `target_id` + `details JSONB`）

`votes` は `(tag_id, user_id)` でUNIQUE制約あり（1ユーザー1タグ1票）。

### スコア計算ロジック（重要）

leverage視界のスコア計算：
```
weight_u(voter) = clamp(1 + w_u(voter)/3, 0, 2)
score_leverage(u) = Σ_vote(value ∈ {+1, -1} × weight_u(voter))
```
- 未フォロー・匿名は `w=0` → `weight=1`
- `+3` → `weight=2`、`-3` → `weight=0`
- **MVP では負の重みの反転効果は実装しない**（v1.5以降で「逆視点」として提供予定）

## 開発の進め方

- タスク管理は `task.md`（RoadMap IDでチェックボックス管理）
- ロードマップは `RoadMap.md`（R1=MVP, R2=発展形, R3=最終目標, R4=運用監視）
- 詳細仕様は `metagmo_spec.md`
- コミットは Conventional Commits 形式：`type(scope?): summary`

### 現在の進捗
- [x] R1-1: DBスキーマ定義（`docs/db-schema.sql`）
- [ ] R1-2: APIルート実装（`metagmo_spec.md` セクション5参照）
- [ ] R1-3: タグリスト/視界トグル/ソート機能
- [ ] R1-4: レバレッジ重み設定UI
- [ ] R1-5: 匿名向けCAPTCHA/30秒クールダウン
- [ ] R1-6: 通報→自動非表示、モデレーターページ

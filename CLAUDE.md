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
npm install

# テスト（手元の D1 で動く。vitest）
npm test

# 型検査
npm run typecheck

# Worker を手元で起動
npm --workspace apps/worker run dev

# リント（今は apps/web だけが対象）
npm run lint
```

`fmt` / `fmt:check` はまだ定義されていない。

## アーキテクチャ

### モノレポ構成（npm workspaces）

```
apps/worker/       # Cloudflare Worker (TypeScript) + D1 — API とページの両方を返す本体
apps/web/          # 旧計画の雛形。使わない（Worker がページを返すようになった時に消す）
packages/types/    # 共有型定義
packages/ui-components/  # 共有UIコンポーネント
packages/utils/    # 共通ユーティリティ
docs/              # 仕様書
```

### 技術スタック
- **土台**: Cloudflare Workers + D1（2026-10-10 決定。経緯と見直す条件は `spec.md` §7）
- **画面**: Worker がページの HTML を返す（各ページを検索結果と X のカードに載せるため）
- **テスト**: vitest + `@cloudflare/vitest-plugin`（手元の D1）
- **ログイン**: MVP には無い。導入を決めた時に土台を見直す
- **スタイル**: Tailwind CSS（導入予定）

### DBスキーマ（`apps/worker/migrations/`）

主要テーブルと関係：
- `entities` → `facts`（1対多）、`tags`（1対多）
- `tags` → `votes`（1対多）
- `history`：操作の記録（`target_type` + `target_id` + `details`＝JSON の文字列）
- `follows`（フォローの重み −3〜+3）は発展形の表で、MVP の D1 には作っていない。ログイン導入を決めた時に足す

MVP はログインなしなので、利用者を指す列（`created_by` / `user_id`）は任意。`votes` の `(tag_id, user_id)` UNIQUE は利用者つきの票にだけ効き、匿名の票は同じタグへ何票でも入る。

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
- [x] R1-1: DBスキーマ定義（`apps/worker/migrations/0001_init.sql`）
- [ ] R1-2: APIルート実装（`metagmo_spec.md` セクション5参照）
- [ ] R1-3: タグリスト/視界トグル/ソート機能
- [ ] R1-4: レバレッジ重み設定UI
- [ ] R1-5: 匿名向けCAPTCHA/30秒クールダウン
- [ ] R1-6: 通報→自動非表示、モデレーターページ

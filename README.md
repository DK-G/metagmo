# メタグモ (metagmo) モノレポ概要

メタグモは、Wikipediaのように「事実（ファクト）」を集積するページを土台に、誰でもタグで主観を可視化できるSNSを構築するプロジェクトです。ユーザーは視界（フィルタ）を切り替え、ものの見え方の差分を体験できます。このリポジトリは、Next.jsクライアントとSupabaseバックエンドを統合したモノレポとして構成されています。

## リポジトリ構成
- `apps/web/`: Next.jsクライアントアプリケーション。画面・ナビゲーション・UIロジックを格納。
- `packages/ui-components/`: 共有UIコンポーネント。
- `packages/utils/`: 共通ユーティリティ関数。
- `packages/types/`: 共有型定義。
- `docs/`: 詳細仕様、計画ドキュメント (`metagumo_spec.md`など)。
- `scripts/`: リポジトリユーティリティ。
- `GEMINI.md`, `RoadMap.md`, `task.md`: 開発計画と日々のタスク管理用ドキュメント。

## 技術スタック
- **フレームワーク:** Next.js (App Router, TypeScript)
- **バックエンド:** Supabase (PostgreSQL, Auth)
- **デプロイ:** Vercel
- **モノレポ管理:** Yarn Workspaces
- **状態管理:** React Hooks / Context (または適宜ライブラリを導入)
- **UI:** Tailwind CSS (または適宜UIライブラリを導入)
- **テスト:** Jest, React Testing Library (E2EはPlaywrightなどを検討)

## 必須環境
- Node.js 18 以上。
- Yarn 1.x（Workspaces 利用）。

## 初期セットアップ
1. 依存関係を一括インストール: `yarn install`
2. 環境変数の設定: `.env.local` ファイルを作成し、SupabaseのAPIキーなどを設定します。
3. 開発サーバー起動: `yarn dev`

## 開発時によく使うコマンド
- リント: `yarn lint`
- フォーマット: `yarn fmt` / `yarn fmt:check`
- テスト: `yarn test`
- ビルド: `yarn build`

## 進め方
- プロジェクトの全体像と目的は `GEMINI.md` を参照してください。
- 長期計画は `RoadMap.md`、日々の作業は `task.md` にて管理します。
- `task.md` には、RoadMap ID（例: `R1-1`）を見出しとして記録し、細分化したチェックボックスで管理します。

## コミットと PR 方針
- Conventional Commits (`type(scope?): summary`) を採用。
- 1 コミット 1 トピックを心がけ、関連タスク番号をメッセージや PR 説明に記載。
- コード変更時は `yarn lint` と必要なテストを実行し、結果を控えておく。

## 参考ドキュメント
- `metagumo_spec.md`: メタグモの全体仕様書。
- `GEMINI.md`: Gemini CLIとの対話のためのプロジェクト概要と開発方針。
- `RoadMap.md`: バージョン別タスク一覧。
- `task.md`: 進行中の詳細タスクとログ。
- `docs/` 配下の仕様書: 各機能の詳細仕様など。

## ライセンス
- 利用ライブラリのライセンスおよびクレジットは `docs/` に追記予定です。
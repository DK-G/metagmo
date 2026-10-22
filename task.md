<!-- CURRENT-START -->
## 現在地（2026-10-22）
- フェーズ: R1 MVP。土台は Cloudflare Workers＋D1（決定 2026-10-10、`spec.md` §7）。
- main: R1-1〜R1-5・トップ一覧（Q-012）・Q-011「全体との差」まで統合済み（10-20）。
- 枝 `agent/metagmo/1021-abuse-guard`（10-21 Kira 承認・main 統合）: Q-007 荒らし対策。書き込み 4 経路に IP ごとの流量制限（D1 `rate_limits`、10 分窓・投稿 20／投票 60）と Turnstile 検証（`X-Turnstile-Token`）。鍵が無ければ 503。詳細は README。
- 検証（枝）: `npm test` 144 件・typecheck・lint 通過。
- 枝 `agent/metagmo/1022-ip-hmac`（夜の列・[AI-PROPOSED]、採否待ち）: D-010 を仮の答え「はい」で実装。IP は鍵 `IP_HASH_KEY` の HMAC-SHA256 で保存・比較、鍵が無ければ 503。`npm test` 147 件・typecheck・lint 通過。
- 次の一手: D-010 枝の採否と D-011 の判断。画面側の Turnstile ウィジェット（今は投稿画面が無い）。順番は `D:/dev/agents/queue/metagmo.md`。
- 本番 D1 は未作成・公開は未実行。
<!-- CURRENT-END -->

## 引継ぎ（2026-10-20・Q-011 の統合）

- 夜の列の `agent/metagmo/1020-page-diff`（差の 2 段）に D-007・D-008 を足して `agent/metagmo/1020-diff-decisions` で main へ統合（Kira の指示）。判断は `spec.md` §7。

# メタグモ タスクリスト

的（Q-xxx）の中身と順番は `D:\dev\agents\queue\metagmo.md`、判断の記録は `spec.md` §7。ここは R1 の進み具合の一覧だけを持つ。2026-10-17 以前の詳細（各 R1 の細目・2026-06-03 の作業方針）は `docs/archive/task-2026-10-17.md`。

## 作業方針
- ファクトは中立・出典必須、タグは主観ラベルという分離を崩さない。
- UI は Wiki / 掲示板 / 検索結果に近い、初見で迷わない配置にする。見た目の手本は `docs/prototype/`。
- 荒らし対策（Q-007）とモデレーションは後付けにしすぎない。

## R1 チェックリスト
1. [x] R1-1 DB スキーマ定義（`apps/worker/migrations/`）
2. [x] R1-2 API ルート実装・認証なし（Q-002。契約は `README.md`）
3. [x] R1-3 ワードクラウド表示（Q-005。`/p/:id`、単語サイズ = ネットスコア）
4. [x] R1-4 視界ボタン（直近一週間・合意・論争）— 集計・API・ページへの組込みまで済み（Q-003/Q-006）。
5. [x] R1-5 タグ検索・並び替え（Q-004。score_desc / newest）

## R1 付帯（番号外）
- [x] トップ `/` のページ一覧（Q-012、10-19 main 統合）
- [x] 「全体との差」の上下 2 段（Q-011、10-20 main 統合）
- [ ] 匿名の投稿・投票の荒らし対策: Turnstile と IP ごとの流量制限（Q-007。旧「CAPTCHA/30 秒クールダウン」）
- [ ] 通報→一時非表示、モデレーターの確認ページ（まだ的にしていない）

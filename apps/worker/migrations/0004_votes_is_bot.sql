-- 透明 BOT の票の印（Q-020・D-015）。運営が置く BOT の票は 1、人の票は 0。
-- 画面と API から入る票は常に 0（既定）。1 は手元用スクリプト（scripts/bot-votes.mjs）か、公開後に運営が入れるだけ。
-- 視界 `?nobot=1` は is_bot = 0 の票だけで数える（src/views.ts の listTagsByView）。
ALTER TABLE votes ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1));

-- タグとファクトへの通報（Q-021・D-016）。
-- 番号は 0005。0004 は採否待ちの枝 agent/metagmo/1122-nobot-view（votes.is_bot）が使っている。
-- 同じ接続元（IP の鍵つきハッシュ。D-010）の同じ対象への通報は 1 行に数える（UNIQUE）。
-- 戻していない（cleared_at が NULL の）通報が 3 件集まった対象は /p/:id と集計から隠す（行は消さない。src/reports.ts）。
-- 戻すときは cleared_at に日時を入れる（README「通報で隠れたものを戻す・消す」）。戻した後、同じ接続元はもう一度通報できない。
CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('tag', 'fact')),
    target_id TEXT NOT NULL,
    reporter_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    cleared_at TEXT,
    UNIQUE (target_type, target_id, reporter_hash)
);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);

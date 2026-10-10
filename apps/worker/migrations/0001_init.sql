-- メタグモ MVP の表（D1 / SQLite）
-- id は UUID の文字列、日時は ISO 8601（UTC）の文字列で持つ。
-- MVP はログインなしなので、利用者を指す列（created_by / user_id）は任意。
-- ログイン導入を決めた時に、利用者の表とあわせて見直す。

-- ページ
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ファクト（出典 URL 必須）
CREATE TABLE facts (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT, -- '一次', '二次', '公式' など
    created_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_facts_entity ON facts(entity_id);

-- タグ（64 字まで）
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    tag_text TEXT NOT NULL CHECK (length(tag_text) BETWEEN 1 AND 64),
    created_by TEXT,
    reported_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tags_entity ON tags(entity_id);

-- 投票
-- 匿名の同一タグへの複数投票は意図的に許容する。
-- 利用者つきの票だけ 1 タグ 1 票（NULL 同士は別値扱いなので匿名は対象外）。
CREATE TABLE votes (
    id TEXT PRIMARY KEY,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    user_id TEXT,
    ip_address TEXT,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (tag_id, user_id)
);
CREATE INDEX idx_votes_tag_created ON votes(tag_id, created_at);

-- 履歴
CREATE TABLE history (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details TEXT CHECK (details IS NULL OR json_valid(details)), -- 変更前後の値など（JSON）
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_history_target ON history(target_type, target_id);

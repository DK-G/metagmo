-- Schema for Meta-Gumo MVP

-- Table: entities (ページ)
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: facts (ファクト)
CREATE TABLE facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT, -- '一次', '二次', '公式' など
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'pending_review' -- 'pending_review', 'approved', 'rejected'
);

-- Table: tags (タグ)
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    tag_text TEXT NOT NULL CHECK (LENGTH(tag_text) <= 64),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reported_count INTEGER DEFAULT 0
);

-- Table: votes (投票)
-- 匿名の同一タグへの複数投票は意図的に許容（flat視界の原則）。
-- ip_address を記録し ip_addr_only 視界でのIP単位重複除去に使用する。
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address INET,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (tag_id, user_id) -- 登録ユーザーのみ1票制約（NULL同士は別値扱いのため匿名は対象外）
);

-- Table: follows (レバレッジ)
CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    followed_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= -3 AND weight <= 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (follower_id, followed_id)
);

-- Table: history (履歴)
CREATE TABLE history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID NOT NULL,
    details JSONB, -- Store old/new values, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const count = async (sql: string, ...binds: unknown[]) =>
  (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;

describe("表の作成", () => {
  it("MVP の 5 表がある", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('entities', 'facts', 'tags', 'votes', 'history') ORDER BY name",
    ).all<{ name: string }>();

    expect(results.map((r) => r.name)).toEqual(["entities", "facts", "history", "tags", "votes"]);
  });
});

describe("読み書き", () => {
  it("ページを 1 件書いて読める", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, ?, ?)")
      .bind(id, "メタグモ", "タグで見え方を切り替える百科")
      .run();

    const row = await env.DB.prepare("SELECT title, summary, created_at FROM entities WHERE id = ?")
      .bind(id)
      .first<{ title: string; summary: string; created_at: string }>();

    expect(row?.title).toBe("メタグモ");
    expect(row?.summary).toBe("タグで見え方を切り替える百科");
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("利用者なしで、ファクト・タグ・投票・履歴を書ける", async () => {
    const entityId = crypto.randomUUID();
    const tagId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(entityId),
      env.DB.prepare(
        "INSERT INTO facts (id, entity_id, content, source_url) VALUES (?, ?, 'c', 'https://example.com/')",
      ).bind(crypto.randomUUID(), entityId),
      env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text) VALUES (?, ?, 'わかりやすい')").bind(tagId, entityId),
      // 匿名の票は同じタグへ何票でも入る
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type) VALUES (?, ?, 'up')").bind(crypto.randomUUID(), tagId),
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type) VALUES (?, ?, 'up')").bind(crypto.randomUUID(), tagId),
      env.DB.prepare(
        "INSERT INTO history (id, action, target_type, target_id, details) VALUES (?, 'create', 'tag', ?, ?)",
      ).bind(crypto.randomUUID(), tagId, JSON.stringify({ tag_text: "わかりやすい" })),
    ]);

    const history = await env.DB.prepare("SELECT user_id FROM history WHERE target_id = ?")
      .bind(tagId)
      .first<{ user_id: string | null }>();

    expect(await count("SELECT COUNT(*) AS n FROM votes WHERE tag_id = ?", tagId)).toBe(2);
    expect(history?.user_id).toBeNull();
  });

  it("65 字のタグは入らない", async () => {
    const entityId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(entityId).run();

    const insert = (text: string) =>
      env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text) VALUES (?, ?, ?)")
        .bind(crypto.randomUUID(), entityId, text)
        .run();

    await insert("あ".repeat(64));
    await expect(insert("あ".repeat(65))).rejects.toThrow();
    expect(await count("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?", entityId)).toBe(1);
  });

  it("同じページに同じ文言のタグは 2 行目が入らない（別のページなら入る）", async () => {
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [a, b]) {
      await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(id).run();
    }
    const insert = (entityId: string, text: string) =>
      env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text) VALUES (?, ?, ?)")
        .bind(crypto.randomUUID(), entityId, text)
        .run();

    await insert(a, "難しい");
    await expect(insert(a, "難しい")).rejects.toThrow(/UNIQUE constraint failed/);
    await insert(a, "易しい");
    await insert(b, "難しい");
    expect(await count("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?", a)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?", b)).toBe(1);
  });

  it("ページを消すと、ぶら下がるタグと投票も消える", async () => {
    const entityId = crypto.randomUUID();
    const tagId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(entityId),
      env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text) VALUES (?, ?, 'x')").bind(tagId, entityId),
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type) VALUES (?, ?, 'down')").bind(crypto.randomUUID(), tagId),
    ]);

    await env.DB.prepare("DELETE FROM entities WHERE id = ?").bind(entityId).run();

    expect(await count("SELECT COUNT(*) AS n FROM votes WHERE tag_id = ?", tagId)).toBe(0);
  });
});

describe("Worker", () => {
  it("/health が D1 に届く", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

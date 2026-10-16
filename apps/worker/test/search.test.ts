import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const get = (path: string) => SELF.fetch(`https://example.com${path}`);
async function seed() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM votes WHERE id IN ('v1','v2','v3')"),
    env.DB.prepare("DELETE FROM tags WHERE id IN ('a','b','c')"),
    env.DB.prepare("DELETE FROM entities WHERE id IN ('old','new','literal')"),
    env.DB.prepare("INSERT INTO entities (id,title,summary,created_at) VALUES ('old','東京タワー','a','2026-01-01'),('new','京都','b','2026-02-01'),('literal','100%_表示','c','2026-03-01')"),
    env.DB.prepare("INSERT INTO tags (id,entity_id,tag_text,created_at) VALUES ('a','old','Beautiful東京','2026-01-01'),('b','old','東京夜景','2026-02-01'),('c','new','東京支店','2026-03-01')"),
    env.DB.prepare("INSERT INTO votes (id,tag_id,vote_type) VALUES ('v1','a','up'),('v2','a','up'),('v3','b','down')"),
  ]);
}
async function ids(path: string, key: "entities" | "tags") {
  const response = await get(path);
  expect(response.status).toBe(200);
  const body = await response.json() as Record<string, { id: string }[]>;
  return body[key].map(row => row.id);
}

describe("検索と並び替え", () => {
  it("タイトルとタグの部分一致でページを重複なく返す", async () => {
    await seed();
    expect(await ids("/api/entities?q=東京", "entities")).toEqual(["new", "old"]);
    expect(await ids("/api/entities?q=beautiful", "entities")).toEqual(["old"]);
    expect(await ids("/api/entities?q=存在しない", "entities")).toEqual([]);
  });
  it("ページは全タグのネットスコアか新着順で並ぶ", async () => {
    await seed();
    expect(await ids("/api/entities?sort=score_desc", "entities")).toEqual(["old", "literal", "new"]);
    expect(await ids("/api/entities?sort=newest", "entities")).toEqual(["literal", "new", "old"]);
  });
  it("ワイルドカードとSQL文字列は文字として検索する", async () => {
    await seed();
    expect(await ids("/api/entities?q=%25_", "entities")).toEqual(["literal"]);
    expect(await ids("/api/entities?q=" + encodeURIComponent("' OR 1=1 --"), "entities")).toEqual([]);
  });
  it("タグを部分一致と2種類の順序で返し、視界の集計も保つ", async () => {
    await seed();
    expect(await ids("/api/entities/old/tags?q=東京", "tags")).toEqual(["a", "b"]);
    expect(await ids("/api/entities/old/tags?q=東京&sort=newest", "tags")).toEqual(["b", "a"]);
    expect(await ids("/api/entities/old/tags?q=beautiful&sort=newest", "tags")).toEqual(["a"]);
    expect(await ids("/api/entities/old/tags?q=東京&recent=1", "tags")).toEqual(["a", "b"]);
    expect(await ids("/api/entities/old/tags?q=東京&consensus=1", "tags")).toEqual([]);
  });
  it("不正な並びと長すぎる検索を拒否する", async () => {
    await seed();
    for (const path of ["/api/entities", "/api/entities/old/tags"]) {
      expect((await get(`${path}?sort=unknown`)).status).toBe(400);
      expect((await get(`${path}?q=${"a".repeat(201)}`)).status).toBe(400);
    }
  });
});

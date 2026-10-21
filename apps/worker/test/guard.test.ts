import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { countAttempt, RATE_LIMITS, RATE_WINDOW_MS, windowStart } from "../src/guard";
import worker from "../src/index";
import { WRITE_HEADERS } from "./write-headers";

const BASE = "https://example.com";

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  SELF.fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

const count = async (sql: string, ...binds: unknown[]) =>
  (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;

async function newEntity() {
  const res = await post("/api/entities", { title: "メタグモ", summary: "要約" }, WRITE_HEADERS());
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

async function newTag(entityId: string) {
  const res = await post(`/api/entities/${entityId}/tags`, { tag_text: "面白い" }, WRITE_HEADERS());
  expect(res.status).toBe(201);
  return ((await res.json()) as { tag: { id: string } }).tag.id;
}

describe("Turnstile の検証", () => {
  it("トークンが無い投稿は 403 で、何も書かれない", async () => {
    const headers = { ...WRITE_HEADERS() };
    delete headers["X-Turnstile-Token"];
    const res = await post("/api/entities", { title: "検証なし", summary: "要約" }, headers);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "turnstile_failed" });
    expect(await count("SELECT COUNT(*) AS n FROM entities WHERE title = ?", "検証なし")).toBe(0);
  });

  it("検証に落ちるトークンの投稿・タグ・ファクト・投票は 403", async () => {
    const entityId = await newEntity();
    const tagId = await newTag(entityId);
    const bad = { ...WRITE_HEADERS(), "X-Turnstile-Token": "fail" };
    const attempts = [
      post("/api/entities", { title: "落ちる", summary: "要約" }, bad),
      post(`/api/entities/${entityId}/facts`, { content: "事実", source_url: "https://example.org" }, bad),
      post(`/api/entities/${entityId}/tags`, { tag_text: "落ちるタグ" }, bad),
      post(`/api/tags/${tagId}/vote`, { vote_type: "up" }, bad),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM facts WHERE entity_id = ?", entityId)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?", entityId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM votes WHERE tag_id = ?", tagId)).toBe(0);
  });

  it("秘密鍵が無ければ書き込みを止める（503）", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/entities`, {
        method: "POST",
        headers: WRITE_HEADERS(),
        body: JSON.stringify({ title: "鍵なし", summary: "要約" }),
      }),
      { DB: env.DB },
    );
    expect(res.status).toBe(503);
    expect(await count("SELECT COUNT(*) AS n FROM entities WHERE title = ?", "鍵なし")).toBe(0);
  });

  it("読むだけの GET は検証しない", async () => {
    const res = await SELF.fetch(`${BASE}/api/entities`);
    expect(res.status).toBe(200);
  });

  it("経路違いは検証より先に 404/405 を返す", async () => {
    expect((await SELF.fetch(`${BASE}/api/nowhere`, { method: "POST" })).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/api/entities/x`, { method: "POST" })).status).toBe(405);
  });
});

describe("IP ごとの流量制限", () => {
  it(`同じ IP の投稿は ${RATE_LIMITS.post} 件まで通り、次は 429`, async () => {
    const headers = { ...WRITE_HEADERS(), "CF-Connecting-IP": "203.0.113.10" };
    for (let i = 0; i < RATE_LIMITS.post; i++) {
      const res = await post("/api/entities", { title: `上限まで ${i}`, summary: "要約" }, headers);
      expect(res.status).toBe(201);
    }
    const over = await post("/api/entities", { title: "上限超え", summary: "要約" }, headers);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate_limited" });
    const retryAfter = Number(over.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(RATE_WINDOW_MS / 1000);
    expect(await count("SELECT COUNT(*) AS n FROM entities WHERE title = ?", "上限超え")).toBe(0);

    // 別の IP は止まらない。
    const other = await post("/api/entities", { title: "別の IP", summary: "要約" }, WRITE_HEADERS());
    expect(other.status).toBe(201);
  });

  it(`同じ IP の投票は ${RATE_LIMITS.vote} 票まで通り、次は 429（投稿の枠とは別）`, async () => {
    const tagId = await newTag(await newEntity());
    const headers = { ...WRITE_HEADERS(), "CF-Connecting-IP": "203.0.113.20" };
    for (let i = 0; i < RATE_LIMITS.vote; i++) {
      expect((await post(`/api/tags/${tagId}/vote`, { vote_type: "up" }, headers)).status).toBe(201);
    }
    expect((await post(`/api/tags/${tagId}/vote`, { vote_type: "up" }, headers)).status).toBe(429);
    expect(await count("SELECT COUNT(*) AS n FROM votes WHERE tag_id = ?", tagId)).toBe(RATE_LIMITS.vote);

    // 同じ IP でも投稿の枠はまだ空いている。
    expect((await post("/api/entities", { title: "投稿は別枠", summary: "要約" }, headers)).status).toBe(201);
  });

  it("検証に落ちた試行も上限に数える", async () => {
    const headers = { ...WRITE_HEADERS(), "CF-Connecting-IP": "203.0.113.30", "X-Turnstile-Token": "fail" };
    for (let i = 0; i < RATE_LIMITS.post; i++) {
      expect((await post("/api/entities", { title: "落ちる", summary: "要約" }, headers)).status).toBe(403);
    }
    const passing = { ...headers, "X-Turnstile-Token": "pass" };
    expect((await post("/api/entities", { title: "通るはず", summary: "要約" }, passing)).status).toBe(429);
  });

  it("窓が変わると数え直し、過ぎた窓の行は消える", async () => {
    const ip = "203.0.113.40";
    const t0 = new Date("2026-10-21T12:00:00.000Z");
    for (let i = 0; i < RATE_LIMITS.post; i++) expect(await countAttempt(env.DB, ip, "post", t0)).toBeNull();
    expect(await countAttempt(env.DB, ip, "post", t0)).toBe(RATE_WINDOW_MS / 1000);

    const t1 = new Date(t0.getTime() + RATE_WINDOW_MS);
    expect(await countAttempt(env.DB, ip, "post", t1)).toBeNull();
    const rows = await env.DB.prepare("SELECT window_start FROM rate_limits WHERE ip = ?").bind(ip).all();
    expect(rows.results).toEqual([{ window_start: windowStart(t1) }]);
  });
});

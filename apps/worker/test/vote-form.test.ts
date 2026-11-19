import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "../src/guard";
import { WRITE_HEADERS } from "./write-headers";

// Q-014: タグごとの賛成・反対ボタン（POST /p/:id/tags/:tagId/vote）。

const BASE = "https://example.com";

async function newEntity(title: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary: "投票ボタンの試験ページ" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

async function newTag(entityId: string, tagText: string) {
  const res = await SELF.fetch(`${BASE}/api/entities/${entityId}/tags`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ tag_text: tagText }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { tag: { id: string } }).tag.id;
}

/** ブラウザのフォーム送信と同じ形（urlencoded）で送る。ボタンはタグのフォームを送るので tag_text も載る。 */
const submit = (path: string, fields: Record<string, string>, ip: string = crypto.randomUUID()) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
    body: new URLSearchParams({ tag_text: "", ...fields }).toString(),
    redirect: "manual",
  });

async function votes(tagId: string): Promise<{ up: number; down: number }> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(vote_type = 'up'), 0) AS up, COALESCE(SUM(vote_type = 'down'), 0) AS down FROM votes WHERE tag_id = ?`,
  )
    .bind(tagId)
    .first<{ up: number; down: number }>();
  return { up: row?.up ?? 0, down: row?.down ?? 0 };
}

describe("タグの賛成・反対ボタン（POST /p/:id/tags/:tagId/vote）", () => {
  it("up と down それぞれで票が 1 件ずつ増え、/p/:id へ 303 で戻る", async () => {
    const id = await newEntity("票を入れる");
    const tagId = await newTag(id, "読みやすい");

    const up = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "up", "cf-turnstile-response": "pass" });
    expect(up.status).toBe(303);
    expect(up.headers.get("Location")).toBe(`/p/${id}`);
    expect(await votes(tagId)).toEqual({ up: 1, down: 0 });

    const down = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "down", "cf-turnstile-response": "pass" });
    expect(down.status).toBe(303);
    expect(await votes(tagId)).toEqual({ up: 1, down: 1 });

    const history = await env.DB.prepare("SELECT COUNT(*) AS n FROM history WHERE action = 'vote' AND target_id = ?")
      .bind(tagId)
      .first<{ n: number }>();
    expect(history?.n).toBe(2);
  });

  it("視界つきの URL から押すと、同じ視界の URL へ戻る", async () => {
    const id = await newEntity("視界へ戻る");
    const tagId = await newTag(id, "合意しそう");
    const res = await submit(`/p/${id}/tags/${tagId}/vote?consensus=1&recent=2`, {
      vote_type: "up",
      "cf-turnstile-response": "pass",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/p/${id}?recent=2&consensus=1`);
    expect(await votes(tagId)).toEqual({ up: 1, down: 0 });
  });

  it("不正な視界の値は 400 で、票は入らない", async () => {
    const id = await newEntity("視界が不正");
    const tagId = await newTag(id, "不正");
    const res = await submit(`/p/${id}/tags/${tagId}/vote?consensus=9`, { vote_type: "up", "cf-turnstile-response": "pass" });
    expect(res.status).toBe(400);
    expect(await votes(tagId)).toEqual({ up: 0, down: 0 });
  });

  it("別のページのタグ id は 404 で、票は入らない", async () => {
    const a = await newEntity("ページ A");
    const b = await newEntity("ページ B");
    const tagOfB = await newTag(b, "B のタグ");
    const res = await submit(`/p/${a}/tags/${tagOfB}/vote`, { vote_type: "up", "cf-turnstile-response": "pass" });
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await votes(tagOfB)).toEqual({ up: 0, down: 0 });
  });

  it("存在しないタグ・ページは 404", async () => {
    const id = await newEntity("無いタグ");
    expect((await submit(`/p/${id}/tags/no-such-tag/vote`, { vote_type: "up", "cf-turnstile-response": "pass" })).status).toBe(404);
    expect((await submit(`/p/no-such-page/tags/x/vote`, { vote_type: "up", "cf-turnstile-response": "pass" })).status).toBe(404);
  });

  it("トークンが無いと 403 で、理由の 1 行つきのページが返り票は入らない", async () => {
    const id = await newEntity("トークン無し");
    const tagId = await newTag(id, "入らない");
    const res = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "up" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain('class="form-error"');
    expect(html).toContain("ロボットでないことの確認");
    expect(await votes(tagId)).toEqual({ up: 0, down: 0 });
  });

  it("検証に落ちるトークンも 403", async () => {
    const id = await newEntity("トークン違い");
    const tagId = await newTag(id, "落ちる");
    const res = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "down", "cf-turnstile-response": "fail" });
    expect(res.status).toBe(403);
    expect(await votes(tagId)).toEqual({ up: 0, down: 0 });
  });

  it("vote_type が up・down 以外は 400", async () => {
    const id = await newEntity("種類違い");
    const tagId = await newTag(id, "種類");
    const res = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "sideways", "cf-turnstile-response": "pass" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("賛成か反対のボタンを押して送ってください。");
    expect(await votes(tagId)).toEqual({ up: 0, down: 0 });
  });

  it(`投票は投稿と別に数え、同じ IP は ${RATE_LIMITS.vote} 票まで通り、次は 429`, async () => {
    const id = await newEntity("流量");
    const tagId = await newTag(id, "連打");
    const ip = crypto.randomUUID();
    for (let i = 0; i < RATE_LIMITS.vote; i++) {
      const res = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "up", "cf-turnstile-response": "pass" }, ip);
      expect(res.status).toBe(303);
    }
    const over = await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "up", "cf-turnstile-response": "pass" }, ip);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await votes(tagId)).up).toBe(RATE_LIMITS.vote);
  });

  it("GET は 405", async () => {
    const id = await newEntity("GET");
    const tagId = await newTag(id, "GET");
    const res = await SELF.fetch(`${BASE}/p/${id}/tags/${tagId}/vote`);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("/p/:id の各タグに、タグのフォームを送る賛成・反対ボタンがあり、ウィジェットは 1 つ", async () => {
    const id = await newEntity("ボタンの有無");
    const t1 = await newTag(id, "一つ目");
    const t2 = await newTag(id, "二つ目");
    // 直近一週間の視界は票のあるタグだけを出すので、両方に 1 票入れておく。
    for (const tagId of [t1, t2]) {
      await submit(`/p/${id}/tags/${tagId}/vote`, { vote_type: "up", "cf-turnstile-response": "pass" });
    }
    const html = await (await SELF.fetch(`${BASE}/p/${id}?recent=1`)).text();
    for (const tagId of [t1, t2]) {
      const action = `/p/${id}/tags/${tagId}/vote?recent=1`;
      expect(html).toContain(`form="tag-form" formaction="${action}" formnovalidate name="vote_type" value="up"`);
      expect(html).toContain(`form="tag-form" formaction="${action}" formnovalidate name="vote_type" value="down"`);
    }
    expect(html.match(/class="cf-turnstile"/g)?.length).toBe(1);
    expect(html).toContain('<form class="tag-form" id="tag-form"');
  });

  it("視界の無いページのボタンは値なしの送り先", async () => {
    const id = await newEntity("既定の視界");
    const tagId = await newTag(id, "既定");
    const html = await (await SELF.fetch(`${BASE}/p/${id}`)).text();
    expect(html).toContain(`formaction="/p/${id}/tags/${tagId}/vote" formnovalidate`);
  });
});

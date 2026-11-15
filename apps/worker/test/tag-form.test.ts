import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "../src/guard";
import { WRITE_HEADERS } from "./write-headers";

const BASE = "https://example.com";

async function newEntity(title: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary: "フォームの試験ページ" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

/** ブラウザのフォーム送信と同じ形（urlencoded）で送る。リダイレクトは追わない。 */
const submit = (path: string, fields: Record<string, string>, ip: string = crypto.randomUUID()) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });

async function tagCount(entityId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?").bind(entityId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("タグを足すフォーム（POST /p/:id/tags）", () => {
  it("フォームで送るとタグが 1 件増え、/p/:id へ 303 で戻る", async () => {
    const id = await newEntity("フォームで足す");
    const res = await submit(`/p/${id}/tags`, { tag_text: "出典確認が前提", "cf-turnstile-response": "pass" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/p/${id}`);
    expect(await tagCount(id)).toBe(1);

    const page = await (await SELF.fetch(`${BASE}/p/${id}`)).text();
    expect(page).toContain("出典確認が前提");
  });

  it("同じ文言をもう一度送っても増えない（API と同じ）", async () => {
    const id = await newEntity("重ねて足す");
    await submit(`/p/${id}/tags`, { tag_text: "同じ", "cf-turnstile-response": "pass" });
    const again = await submit(`/p/${id}/tags`, { tag_text: "同じ", "cf-turnstile-response": "pass" });
    expect(again.status).toBe(303);
    expect(await tagCount(id)).toBe(1);
  });

  it("トークンが無いと 403 で、理由の 1 行つきのページが返りタグは増えない", async () => {
    const id = await newEntity("トークン無し");
    const res = await submit(`/p/${id}/tags`, { tag_text: "入らないはず" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain('class="form-error"');
    expect(html).toContain("ロボットでないことの確認");
    expect(html).toContain('value="入らないはず"');
    expect(await tagCount(id)).toBe(0);
  });

  it("検証に落ちるトークンも 403", async () => {
    const id = await newEntity("トークン違い");
    const res = await submit(`/p/${id}/tags`, { tag_text: "入らない", "cf-turnstile-response": "fail" });
    expect(res.status).toBe(403);
    expect(await tagCount(id)).toBe(0);
  });

  it("65 字は 400 で入らない（64 字は入る）", async () => {
    const id = await newEntity("長さ");
    const over = await submit(`/p/${id}/tags`, { tag_text: "あ".repeat(65), "cf-turnstile-response": "pass" });
    expect(over.status).toBe(400);
    expect(await over.text()).toContain("タグは 64 字までです。");
    expect(await tagCount(id)).toBe(0);

    const ok = await submit(`/p/${id}/tags`, { tag_text: "あ".repeat(64), "cf-turnstile-response": "pass" });
    expect(ok.status).toBe(303);
    expect(await tagCount(id)).toBe(1);
  });

  it("空のタグは 400", async () => {
    const id = await newEntity("空");
    const res = await submit(`/p/${id}/tags`, { tag_text: "   ", "cf-turnstile-response": "pass" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("タグを入力してください。");
  });

  it(`同じ IP は ${RATE_LIMITS.post} 件まで通り、次は 429（Retry-After つき）`, async () => {
    const id = await newEntity("流量");
    const ip = crypto.randomUUID();
    for (let i = 0; i < RATE_LIMITS.post; i++) {
      const res = await submit(`/p/${id}/tags`, { tag_text: `タグ${i}`, "cf-turnstile-response": "pass" }, ip);
      expect(res.status).toBe(303);
    }
    const over = await submit(`/p/${id}/tags`, { tag_text: "超えた", "cf-turnstile-response": "pass" }, ip);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await over.text()).toContain("上限を超えました");
    expect(await tagCount(id)).toBe(RATE_LIMITS.post);
  });

  it("存在しないページは 404", async () => {
    const res = await submit(`/p/no-such-page/tags`, { tag_text: "x", "cf-turnstile-response": "pass" });
    expect(res.status).toBe(404);
  });

  it("GET は 405", async () => {
    const id = await newEntity("GET");
    const res = await SELF.fetch(`${BASE}/p/${id}/tags`);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("/p/:id の HTML にタグのフォームと Turnstile のウィジェットがある", async () => {
    const id = await newEntity("フォームの有無");
    const html = await (await SELF.fetch(`${BASE}/p/${id}`)).text();
    expect(html).toContain(`<form class="tag-form" id="tag-form" method="post" action="/p/${id}/tags">`);
    expect(html).toContain('name="tag_text" maxlength="64"');
    expect(html).toContain('class="cf-turnstile" data-sitekey="1x00000000000000000000AA"');
    expect(html).toContain("challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("API の X-Turnstile-Token の経路は今までどおり通る", async () => {
    const id = await newEntity("API");
    const res = await SELF.fetch(`${BASE}/api/entities/${id}/tags`, {
      method: "POST",
      headers: WRITE_HEADERS(),
      body: JSON.stringify({ tag_text: "API から" }),
    });
    expect(res.status).toBe(201);
    expect(await tagCount(id)).toBe(1);
  });
});

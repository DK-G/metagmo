import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://example.com";

/** ブラウザのフォーム送信と同じ形（urlencoded）で送る。リダイレクトは追わない。 */
const submit = (fields: Record<string, string>, ip: string = crypto.randomUUID()) =>
  SELF.fetch(`${BASE}/new`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });

async function entityCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM entities").first<{ n: number }>();
  return row?.n ?? 0;
}

const PASS = { "cf-turnstile-response": "pass" };

describe("ページを作る画面（GET /new・POST /new）", () => {
  it("GET /new はタイトル・要約のフォームとウィジェットを返し、noindex", async () => {
    const res = await SELF.fetch(`${BASE}/new`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain('action="/new"');
    expect(body).toContain('name="title"');
    expect(body).toContain('name="summary"');
    expect(body).toContain('class="cf-turnstile"');
    expect(body).toContain('<meta name="robots" content="noindex">');
  });

  it("送るとページが 1 件増え、新しい /p/:id へ 303。その /p/:id は 200", async () => {
    const before = await entityCount();
    const res = await submit({ title: "画面から作るページ", summary: "フォームで作った", ...PASS });
    expect(res.status).toBe(303);
    expect(await entityCount()).toBe(before + 1);

    const location = res.headers.get("Location") ?? "";
    expect(location).toMatch(/^\/p\/[0-9a-f-]{36}$/);
    const page = await SELF.fetch(`${BASE}${location}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("画面から作るページ");

    const history = await env.DB.prepare("SELECT COUNT(*) AS n FROM history WHERE action = 'create' AND target_id = ?")
      .bind(location.slice(3))
      .first<{ n: number }>();
    expect(history?.n).toBe(1);
  });

  it("タイトルが空（空白だけ）は 400 で作らず、理由と入力値がフォームに戻る", async () => {
    const before = await entityCount();
    const res = await submit({ title: "   ", summary: "要約は残る<b>", ...PASS });
    expect(res.status).toBe(400);
    expect(await entityCount()).toBe(before);
    const body = await res.text();
    expect(body).toContain("タイトルを入力してください。");
    expect(body).toContain("要約は残る&lt;b&gt;");
  });

  it("要約が空・タイトルが長すぎるのも 400", async () => {
    const noSummary = await submit({ title: "題", summary: "", ...PASS });
    expect(noSummary.status).toBe(400);
    expect(await noSummary.text()).toContain("要約を入力してください。");

    const long = await submit({ title: "あ".repeat(201), summary: "要約", ...PASS });
    expect(long.status).toBe(400);
    expect(await long.text()).toContain("タイトルは 200 字までです。");
  });

  it("トークン無しは 403 で作らず、入力値はフォームに残る", async () => {
    const before = await entityCount();
    const res = await submit({ title: "トークンなし", summary: "要約" });
    expect(res.status).toBe(403);
    expect(await entityCount()).toBe(before);
    expect(await res.text()).toContain('value="トークンなし"');
  });

  it("GET・POST 以外は 405", async () => {
    const res = await SELF.fetch(`${BASE}/new`, { method: "PUT" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, POST");
  });

  it("/ と /p/:id と /about の見出しに /new へのリンクがある", async () => {
    const home = await (await SELF.fetch(`${BASE}/`)).text();
    expect(home).toContain('<a class="new-page-link" href="/new">');

    const created = await submit({ title: "リンク確認", summary: "要約", ...PASS });
    const page = await (await SELF.fetch(`${BASE}${created.headers.get("Location")}`)).text();
    expect(page).toContain('href="/new"');

    const about = await (await SELF.fetch(`${BASE}/about`)).text();
    expect(about).toContain('href="/new"');
  });
});

import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_HEADERS } from "./write-headers";
import { renderHomePage } from "../src/home";

const BASE = "https://example.com";

const get = (path: string, init?: RequestInit) => SELF.fetch(`${BASE}${path}`, init);

async function newEntity(title: string, summary: string, createdAt: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary }),
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { entity: { id: string } }).entity.id;
  // 作成時刻を固定して、並びをミリ秒の偶然に任せない。
  await env.DB.prepare("UPDATE entities SET created_at = ? WHERE id = ?").bind(createdAt, id).run();
  return id;
}

describe("トップ（/）", () => {
  it("ページを新しい順に並べ、各 /p/:id へリンクする", async () => {
    const older = await newEntity("古いページ", "先に作ったページの要約。", "2026-10-01T00:00:00.000Z");
    const newer = await newEntity("新しいページ", "後から作ったページの要約。", "2026-10-02T00:00:00.000Z");

    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();

    expect(html).toContain("古いページ");
    expect(html).toContain("先に作ったページの要約。");
    expect(html).toContain("後から作ったページの要約。");
    expect(html).toContain(`href="/p/${newer}"`);
    expect(html).toContain(`href="/p/${older}"`);
    expect(html.indexOf(`href="/p/${newer}"`)).toBeLessThan(html.indexOf(`href="/p/${older}"`));
    expect(html).toContain('<link rel="canonical" href="https://example.com/">');
  });

  // 同じファイルのテストは D1 を共有するので、空の表は描画の関数で確かめる。
  it("ページが無い時は空の案内を出す", () => {
    const html = renderHomePage([], `${BASE}/`);
    expect(html).toContain("ページはまだありません。");
  });

  it("タイトルと要約をエスケープする", async () => {
    await newEntity("<script>x</script>", "a & b", "2026-10-03T00:00:00.000Z");
    const html = await (await get("/")).text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("GET 以外は 405", async () => {
    const res = await get("/", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
  });
});

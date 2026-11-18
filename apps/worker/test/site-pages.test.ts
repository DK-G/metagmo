import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_HEADERS } from "./write-headers";

const BASE = "https://example.com";

const get = (path: string, init?: RequestInit) => SELF.fetch(`${BASE}${path}`, init);

async function newEntity(title: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary: `${title}の要約。` }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

const HTML = "text/html; charset=utf-8";

describe("404 の HTML（Q-018 ①）", () => {
  it("どの経路にも当たらない URL は見出しつきの 404 の HTML", async () => {
    const res = await get("/no/such/path");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe(HTML);
    const html = await res.text();
    expect(html).toContain("<h1>ページが見つかりません</h1>");
    expect(html).toContain('<a href="/">トップへ戻る</a>');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('href="/about"');
  });

  it("存在しない /p/:id と壊れた id も同じ 404 の HTML", async () => {
    for (const path of ["/p/no-such-page", "/p/%E0%A4%A"]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).toBe(HTML);
      expect(await res.text()).toContain("<h1>ページが見つかりません</h1>");
    }
  });

  it("API の 404 は JSON のまま", async () => {
    const res = await get("/api/no-such");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("/robots.txt（Q-018 ②）", () => {
  it("全体を許し、API を外し、sitemap の場所を書く", async () => {
    const res = await get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });

  it("GET 以外は 405", async () => {
    expect((await get("/robots.txt", { method: "POST" })).status).toBe(405);
  });
});

describe("/sitemap.xml（Q-018 ②）", () => {
  it("トップ・/about と全ページの /p/:id を載せる", async () => {
    const a = await newEntity("サイトマップのページA");
    const b = await newEntity("サイトマップのページB");
    const res = await get("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).toContain(`<loc>${BASE}/about</loc>`);
    expect(xml).toContain(`<loc>${BASE}/p/${a}</loc><lastmod>`);
    expect(xml).toContain(`<loc>${BASE}/p/${b}</loc><lastmod>`);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it("GET 以外は 405", async () => {
    expect((await get("/sitemap.xml", { method: "POST" })).status).toBe(405);
  });
});

describe("/about（Q-018 ③）", () => {
  it("メタグモとは・ファクトとタグの違い・視界の読み方・接続元の記録を書く", async () => {
    const res = await get("/about");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(HTML);
    const html = await res.text();
    expect(html).toContain("<h1>メタグモについて</h1>");
    expect(html).toContain("<h2>メタグモとは</h2>");
    expect(html).toContain("<h2>ファクトとタグの違い</h2>");
    expect(html).toContain("<h2>視界の読み方</h2>");
    expect(html).toContain("直近一週間");
    expect(html).toContain("合意");
    expect(html).toContain("論争");
    // D-010: 鍵つきのハッシュだけを保存し、生の IP は持たない
    expect(html).toContain("<h2>接続元の記録について</h2>");
    expect(html).toContain("鍵つきのハッシュ");
    expect(html).toContain("IP アドレスそのものは保存しません");
    expect(html).toContain(`<link rel="canonical" href="${BASE}/about">`);
  });

  it("GET 以外は 405", async () => {
    expect((await get("/about", { method: "POST" })).status).toBe(405);
  });
});

describe("フッターから /about へ（Q-018）", () => {
  it("トップと /p/:id のフッターに /about へのリンクがある", async () => {
    const id = await newEntity("フッターのページ");
    for (const path of ["/", `/p/${id}`]) {
      const html = await (await get(path)).text();
      expect(html).toMatch(/<footer class="site-footer">.*<a href="\/about">メタグモについて<\/a>.*<\/footer>/);
    }
  });
});

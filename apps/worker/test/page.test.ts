import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { escapeHtml, wordSize } from "../src/page";

const BASE = "https://example.com";

const get = (path: string, init?: RequestInit) => SELF.fetch(`${BASE}${path}`, init);
const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function newEntity(title: string, summary: string) {
  const res = await post("/api/entities", { title, summary });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

async function newTag(entityId: string, tagText: string, ups: number, downs: number) {
  const res = await post(`/api/entities/${entityId}/tags`, { tag_text: tagText });
  const tagId = ((await res.json()) as { tag: { id: string } }).tag.id;
  for (let i = 0; i < ups; i++) await post(`/api/tags/${tagId}/vote`, { vote_type: "up" });
  for (let i = 0; i < downs; i++) await post(`/api/tags/${tagId}/vote`, { vote_type: "down" });
  return tagId;
}

async function newFact(entityId: string, content: string, status?: string) {
  const res = await post(`/api/entities/${entityId}/facts`, { content, source_url: "https://www.mext.go.jp/" });
  const factId = ((await res.json()) as { fact: { id: string } }).fact.id;
  if (status) await env.DB.prepare("UPDATE facts SET status = ? WHERE id = ?").bind(status, factId).run();
  return factId;
}

/** ワードクラウドの中の語ごとの大きさ（px）を、出てくる順に返す。 */
function cloudSizes(html: string): Array<[string, number]> {
  const cloud = html.slice(html.indexOf('class="cloud"'), html.indexOf('class="tag-list"'));
  return [...cloud.matchAll(/--size: (\d+)px"[^>]*>([^<]+)<small>/g)].map((m) => [m[2], Number(m[1])]);
}

describe("ページ表示（/p/:id）", () => {
  it("タイトル・要約・ファクト・タグが HTML に入る", async () => {
    const id = await newEntity("生成AIと学習", "事実と印象を分けて見えるようにする試験ページ。");
    await newFact(id, "文部科学省は利用場面に応じた扱いを求めている。");
    await newTag(id, "出典確認が前提", 3, 1);

    const res = await get(`/p/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("<h1>生成AIと学習</h1>");
    expect(html).toContain("事実と印象を分けて見えるようにする試験ページ。");
    expect(html).toContain("文部科学省は利用場面に応じた扱いを求めている。");
    expect(html).toContain('href="https://www.mext.go.jp/"');
    expect(html).toContain("出典確認が前提");
    expect(html).toContain("<title>生成AIと学習 | メタグモ</title>");
  });

  it("検索結果と X のカード向けの meta が入る", async () => {
    const id = await newEntity("地方観光とSNS", "利益と負担を分けて眺めるページ。");
    const html = await (await get(`/p/${id}`)).text();
    expect(html).toContain('<meta property="og:title" content="地方観光とSNS">');
    expect(html).toContain('<meta property="og:description" content="利益と負担を分けて眺めるページ。">');
    expect(html).toContain(`<link rel="canonical" href="${BASE}/p/${id}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("審査待ちのファクトは出し、却下は出さない", async () => {
    const id = await newEntity("審査", "ファクトの出し分け");
    await newFact(id, "審査待ちのファクト");
    await newFact(id, "承認済みのファクト", "approved");
    await newFact(id, "却下されたファクト", "rejected");

    const html = await (await get(`/p/${id}`)).text();
    expect(html).toContain("審査待ちのファクト");
    expect(html).toContain("承認済みのファクト");
    expect(html).not.toContain("却下されたファクト");
    expect(html).toContain("<strong>2</strong><span>Facts</span>");
  });

  it("ワードクラウドの語の大きさは up - down で決まり、マイナスは別の色", async () => {
    const id = await newEntity("大きさ", "ネットスコアで語の大きさが変わる");
    await newTag(id, "大きい語", 5, 1); // +4
    await newTag(id, "中くらい", 3, 1); // +2
    await newTag(id, "反対多め", 0, 2); // -2
    await newTag(id, "票なし", 0, 0); // 0

    const html = await (await get(`/p/${id}`)).text();
    const sizes = Object.fromEntries(cloudSizes(html));
    expect(sizes).toEqual({ 大きい語: 56, 中くらい: 37, 反対多め: 37, 票なし: 18 });
    expect(html).toMatch(/class="cloud-word negative"[^>]*>反対多め/);
    expect(html).toMatch(/class="cloud-word"[^>]*>大きい語/);
  });

  it("入力の文字は HTML として解釈させない", async () => {
    const id = await newEntity('<script>alert("x")</script>', "a & b");
    await newTag(id, "<b>太字</b>", 1, 0);
    const html = await (await get(`/p/${id}`)).text();
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>太字</b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("http(s) でない出典はリンクにしない", async () => {
    const id = await newEntity("出典", "古い値が入っていても");
    const factId = await newFact(id, "変な出典");
    await env.DB.prepare("UPDATE facts SET source_url = ? WHERE id = ?").bind("javascript:alert(1)", factId).run();
    const html = await (await get(`/p/${id}`)).text();
    expect(html).not.toContain("javascript:");
  });

  it("タグもファクトも無いページは空の案内を出す", async () => {
    const id = await newEntity("空", "まだ何も無い");
    const html = await (await get(`/p/${id}`)).text();
    expect(html).toContain("ファクトはまだありません。");
    expect(html).toContain("この視界に一致するタグはまだありません。");
  });

  it("無いページは 404、GET 以外は 405", async () => {
    expect((await get("/p/no-such-page")).status).toBe(404);
    expect((await get("/p/%E0%A4%A")).status).toBe(404);
    const id = await newEntity("メソッド", "GET だけ");
    const res = await get(`/p/${id}`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
  });
});

describe("部品", () => {
  it("wordSize は 18〜56 に写す", () => {
    expect(wordSize(0, 10)).toBe(18);
    expect(wordSize(10, 10)).toBe(56);
    expect(wordSize(-5, 10)).toBe(37);
    expect(wordSize(0, 0)).toBe(18);
  });

  it("escapeHtml は 5 文字を置き換える", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

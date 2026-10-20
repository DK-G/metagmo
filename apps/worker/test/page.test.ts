import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { diffSize, escapeHtml, wordSize } from "../src/page";

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

/** タグ一覧（.tag-list）に出たタグ名を、出てくる順に返す。 */
function listedTags(html: string): string[] {
  const list = html.slice(html.indexOf('class="tag-list"'));
  return [...list.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
}

/** 視界ボタン 1 つ分の <a> タグを返す。 */
function viewButton(html: string, id: string): string {
  const m = new RegExp(`<a class="view-button[^>]*data-view="${id}"[^>]*>`).exec(html);
  expect(m).not.toBeNull();
  return m![0];
}

describe("ページの視界ボタン（/p/:id?consensus= など）", () => {
  it("既定ではボタン 3 つが未押しで、押した先のリンクを持つ", async () => {
    const id = await newEntity("視界ボタンの既定", "未押しの確認。");
    await newTag(id, "合意される語", 4, 0);
    const html = await (await get(`/p/${id}`)).text();
    expect(html).toContain('<nav class="view-controls" aria-label="視界ボタン">');
    for (const view of ["recent", "consensus", "controversy"]) {
      expect(viewButton(html, view)).toContain("state-0");
    }
    expect(viewButton(html, "consensus")).toContain(`href="/p/${id}?consensus=1"`);
  });

  it("?consensus=1 で合意ボタンが state-1 になり、表示するタグが既定と変わる", async () => {
    const id = await newEntity("視界ボタンの合意", "合意の確認。");
    await newTag(id, "合意される語", 4, 0);
    await newTag(id, "拒否される語", 0, 4);
    await newTag(id, "割れる語", 2, 2);

    const base = await (await get(`/p/${id}`)).text();
    expect(listedTags(base).sort()).toEqual(["割れる語", "合意される語", "拒否される語"].sort());

    const res = await get(`/p/${id}?consensus=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const consensus = viewButton(html, "consensus");
    expect(consensus).toContain("view-button state-1");
    expect(consensus).toContain(`href="/p/${id}?consensus=2"`);
    expect(html).toContain("<span>合意</span><strong>合意</strong>");
    // 他のボタンは今の視界を保ったまま、自分だけ次の状態へ進める。
    expect(viewButton(html, "recent")).toContain(`href="/p/${id}?recent=1&amp;consensus=1"`);
    expect(listedTags(html)).toEqual(["合意される語"]);
    // canonical は視界の値を付けない。
    expect(html).toContain(`<link rel="canonical" href="${BASE}/p/${id}">`);
  });

  it("?consensus=2・?controversy=1 もそれぞれのタグに絞る", async () => {
    const id = await newEntity("視界ボタンの拒否と論争", "2 回目と論争の確認。");
    await newTag(id, "合意される語", 4, 0);
    await newTag(id, "拒否される語", 0, 4);
    await newTag(id, "割れる語", 2, 2);

    const rejected = await (await get(`/p/${id}?consensus=2`)).text();
    expect(viewButton(rejected, "consensus")).toContain("state-2");
    expect(viewButton(rejected, "consensus")).toContain(`href="/p/${id}"`);
    expect(listedTags(rejected)).toEqual(["拒否される語"]);

    const disputed = await (await get(`/p/${id}?controversy=1`)).text();
    expect(viewButton(disputed, "controversy")).toContain("state-1");
    expect(listedTags(disputed)).toEqual(["割れる語"]);
  });

  it("不正な視界の値は 400", async () => {
    const id = await newEntity("視界ボタンの不正値", "400 の確認。");
    for (const q of ["?consensus=3", "?recent=x", "?controversy="]) {
      const res = await get(`/p/${id}${q}`);
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    }
  });
});

/** 差の 1 段（diff-up / diff-down）に出たタグ名と大きさ（px）を、出てくる順に返す。 */
function diffRow(html: string, row: "diff-up" | "diff-down"): Array<[string, number]> {
  const start = html.indexOf(`class="diff-row ${row}"`);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</div></div>", start);
  return [...html.slice(start, end).matchAll(/--size: (\d+)px"[^>]*>([^<]+)<em>/g)].map((m) => [m[2], Number(m[1])]);
}

describe("ページの「全体との差」（Q-011）", () => {
  it("既定の表示はワードクラウドのままで、差は閉じた <details> に入り、ボタンを押すよう 1 行出す", async () => {
    const id = await newEntity("差の既定", "未押しの確認。");
    await newTag(id, "合意される語", 4, 0);
    const html = await (await get(`/p/${id}`)).text();
    expect(html).toContain('<div class="cloud" aria-label="タグワードクラウド">');
    expect(html).toContain('<details class="view-diff">');
    expect(html).not.toContain('<details class="view-diff" open');
    expect(html).toContain("視界ボタンを押すと");
    expect(html).not.toContain('class="diff-row');
  });

  it("視界で上がったタグが上段、下がったタグが下段に入り、変わらないタグは出ない", async () => {
    const id = await newEntity("差の 2 段", "合意の視界との差。");
    // 全体の票は 4 + 4 + 4 = 12。合意の視界に残るのは「合意される語」だけ。
    await newTag(id, "合意される語", 4, 0);
    await newTag(id, "拒否される語", 0, 4);
    await newTag(id, "割れる語", 2, 2);

    const html = await (await get(`/p/${id}?consensus=1`)).text();
    expect(diffRow(html, "diff-up").map(([t]) => t)).toEqual(["合意される語"]);
    expect(diffRow(html, "diff-down").map(([t]) => t).sort()).toEqual(["割れる語", "拒否される語"].sort());
    expect(html).toContain("33% → 100%");
    expect(html).toContain("33% → 0%");
  });

  it("語の大きさは差の大きさで、差の大きい語ほど大きい", async () => {
    const id = await newEntity("差の大きさ", "論争の視界との差。");
    // 全体: 大 8 票・中 4 票・小 4 票 = 16。論争の視界（30〜70%）に残るのは「割れる大」と「割れる小」。
    await newTag(id, "割れる大", 4, 4);
    await newTag(id, "合意の中", 4, 0);
    await newTag(id, "割れる小", 2, 2);

    const html = await (await get(`/p/${id}?controversy=1`)).text();
    // 視界: 大 8/12・小 4/12。差は 大 +0.167・小 +0.083・中 −0.25。
    const up = Object.fromEntries(diffRow(html, "diff-up"));
    const down = Object.fromEntries(diffRow(html, "diff-down"));
    expect(Object.keys(up).sort()).toEqual(["割れる大", "割れる小"].sort());
    expect(Object.keys(down)).toEqual(["合意の中"]);
    expect(down["合意の中"]).toBe(56);
    expect(up["割れる大"]).toBeGreaterThan(up["割れる小"]);
    expect(down["合意の中"]).toBeGreaterThan(up["割れる大"]);
  });

  it("比率が全く変わらなければ、2 段とも「ありません」を出す", async () => {
    const id = await newEntity("差なし", "全タグが視界に残る。");
    await newTag(id, "合意 A", 4, 0);
    await newTag(id, "合意 B", 3, 0);
    const html = await (await get(`/p/${id}?consensus=1`)).text();
    expect(diffRow(html, "diff-up")).toEqual([]);
    expect(diffRow(html, "diff-down")).toEqual([]);
    expect(html).toContain("この視界で比率の上がったタグはありません。");
    expect(html).toContain("この視界で比率の下がったタグはありません。");
  });

  it("視界に票が 1 つも無ければ、2 段を出さず比べられない旨の 1 行だけ出す（D-007）", async () => {
    const id = await newEntity("票が新しいだけ", "一週間より前の票が無い。");
    await newTag(id, "新しい票", 3, 0);
    // 票はすべて今入れたので、?recent=2（一週間より前の票だけ）には票が無い。
    const html = await (await get(`/p/${id}?recent=2`)).text();
    expect(html).toContain("この視界には票が 1 つも無いので、全体と比べられません。");
    expect(html).not.toContain('class="diff-row');
    expect(html).not.toContain("下がったタグはありません");
  });

  it("直近一週間の視界だけ、大きさが偶然の揺れで割った差だと書き添える（D-008）", async () => {
    const id = await newEntity("書き添え", "直近とそれ以外。");
    await newTag(id, "タグ", 2, 0);
    const recent = await (await get(`/p/${id}?recent=1`)).text();
    const consensus = await (await get(`/p/${id}?consensus=1`)).text();
    expect(recent).toContain("偶然に出る揺れで差を割った値です。");
    expect(consensus).not.toContain("偶然に出る揺れ");
  });
});

describe("diffSize", () => {
  it("差の大きさを 18〜56 に写し、最大が 0 なら 18", () => {
    expect(diffSize(0.25, 0.25)).toBe(56);
    expect(diffSize(-0.25, 0.25)).toBe(56);
    expect(diffSize(0.125, 0.25)).toBe(37);
    expect(diffSize(0, 0)).toBe(18);
  });
});

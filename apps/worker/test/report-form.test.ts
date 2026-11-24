import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { searchEntities } from "../src/search";
import { listTagsByView } from "../src/views";
import { WRITE_HEADERS } from "./write-headers";

// Q-021・D-016: タグとファクトへの通報（POST /p/:id/report）。3 件で /p/:id と集計から隠す。

const BASE = "https://example.com";

async function newEntity(title: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary: "通報の試験ページ" }),
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

async function newFact(entityId: string, content: string) {
  const res = await SELF.fetch(`${BASE}/api/entities/${entityId}/facts`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ content, source_url: "https://example.org/source" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { fact: { id: string } }).fact.id;
}

async function addVotes(tagId: string, up: number, down: number) {
  const rows = [...Array(up).fill("up"), ...Array(down).fill("down")] as string[];
  await env.DB.batch(
    rows.map((t) => env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type) VALUES (?, ?, ?)").bind(crypto.randomUUID(), tagId, t)),
  );
}

/** ブラウザのフォーム送信と同じ形（urlencoded）。ボタンはタグのフォームを送るので tag_text も載る。 */
const report = (
  entityId: string,
  target: string,
  ip: string = crypto.randomUUID(),
  token: string | null = "pass",
) =>
  SELF.fetch(`${BASE}/p/${entityId}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
    body: new URLSearchParams({ tag_text: "", target, ...(token === null ? {} : { "cf-turnstile-response": token }) }).toString(),
    redirect: "manual",
  });

const pageHtml = async (id: string, query = "") => (await SELF.fetch(`${BASE}/p/${id}${query}`)).text();

async function reportCount(type: string, id: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_type = ? AND target_id = ?")
    .bind(type, id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("通報（POST /p/:id/report）", () => {
  it("① タグは通報 2 件では出たまま、3 件で /p/:id から消える（行は残る）", async () => {
    const id = await newEntity("通報で隠れる");
    const tagId = await newTag(id, "隠れるタグ");
    await newTag(id, "残るタグ");

    for (let i = 0; i < 2; i++) {
      const res = await report(id, `tag:${tagId}`);
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe(`/p/${id}?reported=1`);
    }
    expect(await pageHtml(id)).toContain("隠れるタグ");

    expect((await report(id, `tag:${tagId}`)).status).toBe(303);
    const html = await pageHtml(id);
    expect(html).not.toContain("隠れるタグ");
    expect(html).toContain("残るタグ");
    const row = await env.DB.prepare("SELECT 1 AS ok FROM tags WHERE id = ?").bind(tagId).first();
    expect(row).not.toBeNull();
  });

  it("ファクトも 3 件で /p/:id から消える", async () => {
    const id = await newEntity("ファクトの通報");
    const factId = await newFact(id, "隠れるファクト");
    for (let i = 0; i < 3; i++) {
      expect((await report(id, `fact:${factId}`)).status).toBe(303);
    }
    expect(await pageHtml(id)).not.toContain("隠れるファクト");
  });

  it("② 同じ接続元からの 3 回は 1 件に数え、隠れない", async () => {
    const id = await newEntity("同じ接続元");
    const tagId = await newTag(id, "まだ出るタグ");
    const ip = crypto.randomUUID();
    for (let i = 0; i < 3; i++) {
      expect((await report(id, `tag:${tagId}`, ip)).status).toBe(303);
    }
    expect(await reportCount("tag", tagId)).toBe(1);
    expect(await pageHtml(id)).toContain("まだ出るタグ");
  });

  it("③ トークンが無いと 403 で、通報は入らない", async () => {
    const id = await newEntity("トークン無し");
    const tagId = await newTag(id, "タグ");
    const res = await report(id, `tag:${tagId}`, crypto.randomUUID(), null);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("ロボットでないことの確認");
    expect(await reportCount("tag", tagId)).toBe(0);
  });

  it("④ 別ページのタグ・ファクトの id は 404 で、通報は入らない", async () => {
    const a = await newEntity("ページ A");
    const b = await newEntity("ページ B");
    const tagOfB = await newTag(b, "B のタグ");
    const factOfB = await newFact(b, "B のファクト");
    expect((await report(a, `tag:${tagOfB}`)).status).toBe(404);
    expect((await report(a, `fact:${factOfB}`)).status).toBe(404);
    expect((await report(a, "tag:no-such-tag")).status).toBe(404);
    expect(await reportCount("tag", tagOfB)).toBe(0);
    expect(await reportCount("fact", factOfB)).toBe(0);
  });

  it("⑤ 隠れたタグは視界の集計（既定・合意）と検索にも入らない", async () => {
    const id = await newEntity("集計から外れる");
    const hidden = await newTag(id, "集計から消えるタグ");
    const kept = await newTag(id, "集計に残るタグ");
    await addVotes(hidden, 9, 1);
    await addVotes(kept, 8, 2);
    for (let i = 0; i < 3; i++) await report(id, `tag:${hidden}`);

    const all = await listTagsByView(env.DB, id);
    expect(all.map((t) => t.id)).toEqual([kept]);
    const consensus = await listTagsByView(env.DB, id, { recent: 0, consensus: 1, controversy: 0, nobot: 0 });
    expect(consensus.map((t) => t.id)).toEqual([kept]);
    // Q-020 の「BOT の票を除く」視界と重ねても、隠れたタグは出ない（merge で両方の条件を残した行）。
    const nobot = await listTagsByView(env.DB, id, { recent: 0, consensus: 0, controversy: 0, nobot: 1 });
    expect(nobot.map((t) => t.id)).toEqual([kept]);

    // 合意の視界のページにも出ない（全体との差の 2 段にも出ない）
    expect(await pageHtml(id, "?consensus=1")).not.toContain("集計から消えるタグ");

    // 検索: 隠れたタグの語では当たらず、スコアにも入らない
    expect(await searchEntities(env.DB, { q: "集計から消える", sort: "newest" }, 50)).toHaveLength(0);
    const [entity] = await searchEntities(env.DB, { q: "集計から外れる", sort: "newest" }, 50);
    expect(entity.score).toBe(8 - 2);
  });

  it("戻した通報（cleared_at あり）は数えず、また出る", async () => {
    const id = await newEntity("戻す");
    const tagId = await newTag(id, "戻るタグ");
    for (let i = 0; i < 3; i++) await report(id, `tag:${tagId}`);
    expect(await pageHtml(id)).not.toContain("戻るタグ");
    await env.DB.prepare(
      "UPDATE reports SET cleared_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE target_type = 'tag' AND target_id = ?",
    )
      .bind(tagId)
      .run();
    expect(await pageHtml(id)).toContain("戻るタグ");
  });

  it("対象の値が読めなければ 400、GET は 405、無いページは 404", async () => {
    const id = await newEntity("入力");
    const bad = await report(id, "comment:x");
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("通報する対象が分かりませんでした");

    const get = await SELF.fetch(`${BASE}/p/${id}/report`);
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");

    expect((await report("no-such-page", "tag:x")).status).toBe(404);
  });

  it("/p/:id にタグとファクトの通報ボタンがあり、?reported=1 で受け付けの 1 行が出る", async () => {
    const id = await newEntity("ボタン");
    const tagId = await newTag(id, "ボタンのタグ");
    const factId = await newFact(id, "ボタンのファクト");
    const html = await pageHtml(id);
    expect(html).toContain(`form="tag-form" formaction="/p/${id}/report" formnovalidate name="target" value="tag:${tagId}"`);
    expect(html).toContain(`form="fact-form" formaction="/p/${id}/report" formnovalidate name="target" value="fact:${factId}"`);
    expect(html).not.toContain("通報を受け付けました");
    expect(await pageHtml(id, "?reported=1")).toContain("通報を受け付けました");
  });
});

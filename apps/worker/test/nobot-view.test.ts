// Q-020・D-015: 透明 BOT の票（votes.is_bot = 1）と「BOT の票を除く」視界（?nobot=1）。
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, listTagsByView, type ViewState } from "../src/views";

const BASE = "https://example.com";
const NOW = new Date("2026-11-22T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

type Vote = ["up" | "down", "human" | "bot", string?];

async function newEntity(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 'BOT の票', '視界の確認')").bind(id).run();
  return id;
}

async function tag(entityId: string, text: string, votes: Vote[]): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text, created_at) VALUES (?, ?, ?, ?)").bind(
      id,
      entityId,
      text,
      daysAgo(30),
    ),
    ...votes.map(([type, who, at]) =>
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, is_bot, created_at) VALUES (?, ?, ?, ?, ?)").bind(
        crypto.randomUUID(),
        id,
        type,
        who === "bot" ? 1 : 0,
        at ?? daysAgo(1),
      ),
    ),
  ]);
  return id;
}

const n = (count: number, v: Vote): Vote[] => Array.from({ length: count }, () => v);
const counts = async (entityId: string, view: ViewState) =>
  (await listTagsByView(env.DB, entityId, view, NOW)).map((t) => [t.tag_text, t.up, t.down]);
const names = async (entityId: string, view: ViewState) => (await counts(entityId, view)).map((r) => r[0]).sort();
const NOBOT: ViewState = { ...DEFAULT_VIEW, nobot: 1 };

describe("BOT の票の印", () => {
  it("票の既定は人の票（is_bot = 0）で、0・1 以外は入らない", async () => {
    const entityId = await newEntity();
    const tagId = await tag(entityId, "既定", []);
    await env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type) VALUES (?, ?, 'up')")
      .bind(crypto.randomUUID(), tagId)
      .run();
    const row = await env.DB.prepare("SELECT is_bot FROM votes WHERE tag_id = ?").bind(tagId).first<{ is_bot: number }>();
    expect(row?.is_bot).toBe(0);
    await expect(
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, is_bot) VALUES (?, ?, 'up', 2)")
        .bind(crypto.randomUUID(), tagId)
        .run(),
    ).rejects.toThrow();
  });
});

describe("BOT の票を除く視界の集計", () => {
  it("① BOT の票を含むページでは、既定と ?nobot=1 とで集計が変わる", async () => {
    const entityId = await newEntity();
    await tag(entityId, "BOT が押した", [...n(3, ["up", "bot"]), ["down", "human"]]);
    await tag(entityId, "人だけ", n(1, ["up", "human"]));

    expect(await counts(entityId, DEFAULT_VIEW)).toEqual([
      ["BOT が押した", 3, 1],
      ["人だけ", 1, 0],
    ]);
    // 人の票だけで数え直すと並びも変わる。タグは消さず、人の票だけの数で残る。
    expect(await counts(entityId, NOBOT)).toEqual([
      ["人だけ", 1, 0],
      ["BOT が押した", 0, 1],
    ]);
  });

  it("② BOT の票が無いページでは、?nobot=1 でも同じ", async () => {
    const entityId = await newEntity();
    await tag(entityId, "賛成多め", [...n(4, ["up", "human"]), ["down", "human"]]);
    await tag(entityId, "割れている", [...n(2, ["up", "human"]), ...n(2, ["down", "human"])]);
    await tag(entityId, "票なし", []);
    expect(await counts(entityId, NOBOT)).toEqual(await counts(entityId, DEFAULT_VIEW));
  });

  it("他の視界と重ねると、BOT の票を除いてから絞る", async () => {
    const entityId = await newEntity();
    // BOT の up で合意に見えるが、人の票だけなら 1 対 2 で合意ではない。
    await tag(entityId, "BOT で合意", [...n(5, ["up", "bot"]), ["up", "human"], ...n(2, ["down", "human"])]);
    // 今週の票は BOT だけ。人の票は 20 日前。
    await tag(entityId, "今週は BOT だけ", [["up", "bot"], ...n(3, ["up", "human", daysAgo(20)])]);

    expect(await names(entityId, { ...DEFAULT_VIEW, consensus: 1 })).toEqual(["BOT で合意", "今週は BOT だけ"].sort());
    expect(await names(entityId, { ...NOBOT, consensus: 1 })).toEqual(["今週は BOT だけ"]);
    expect(await names(entityId, { ...DEFAULT_VIEW, recent: 1 })).toEqual(["BOT で合意", "今週は BOT だけ"].sort());
    expect(await names(entityId, { ...NOBOT, recent: 1 })).toEqual(["BOT で合意"]);
  });
});

describe("ページ（/p/:id?nobot=1）", () => {
  it("③ 他の視界と組み合わせた URL が 200 で、④ canonical は視界の値を付けない", async () => {
    const entityId = await newEntity();
    await tag(entityId, "BOT が押した", [...n(3, ["up", "bot"]), ["down", "human"]]);
    const queries = [
      "nobot=1",
      "nobot=0",
      "recent=1&nobot=1",
      "consensus=2&controversy=1&nobot=1",
      "recent=2&consensus=1&controversy=2&nobot=1",
    ];
    for (const query of queries) {
      const res = await SELF.fetch(`${BASE}/p/${entityId}?${query}`);
      expect(res.status, query).toBe(200);
      const html = await res.text();
      expect(html, query).toContain(`<link rel="canonical" href="${BASE}/p/${entityId}">`);
      expect(html, query).toContain(`<meta property="og:url" content="${BASE}/p/${entityId}">`);
    }
  });

  it("BOT の票のボタンは、押すと ?nobot=1 へ、もう一度押すと外れる。他の視界は保つ", async () => {
    const entityId = await newEntity();
    await tag(entityId, "BOT が押した", [...n(3, ["up", "bot"]), ["down", "human"]]);
    const button = (html: string) => html.match(/<a class="view-button[^>]*data-view="nobot"[^>]*>.*?<\/a>/)?.[0] ?? "";

    const off = await (await SELF.fetch(`${BASE}/p/${entityId}?consensus=1`)).text();
    expect(button(off)).toContain(`href="/p/${entityId}?consensus=1&amp;nobot=1"`);
    expect(button(off)).toContain("<strong>含める</strong>");

    const on = await (await SELF.fetch(`${BASE}/p/${entityId}?consensus=1&nobot=1`)).text();
    expect(button(on)).toContain(`href="/p/${entityId}?consensus=1"`);
    expect(button(on)).toContain('class="view-button state-1"');
    expect(button(on)).toContain("<strong>除く</strong>");
    // 他の視界のボタンも nobot=1 を引き継ぐ。
    expect(on).toContain(`href="/p/${entityId}?recent=1&amp;consensus=1&amp;nobot=1"`);
  });

  it("BOT の票を除くと、タグの票数が人の票だけになり、全体との差が出る", async () => {
    const entityId = await newEntity();
    await tag(entityId, "BOT が押した", [...n(3, ["up", "bot"]), ["down", "human"]]);
    await tag(entityId, "人だけ", n(2, ["up", "human"]));
    const all = await (await SELF.fetch(`${BASE}/p/${entityId}`)).text();
    const nobot = await (await SELF.fetch(`${BASE}/p/${entityId}?nobot=1`)).text();
    expect(all).toContain("net 2 / total 4");
    expect(nobot).toContain("net -1 / total 1");
    expect(nobot).toContain('aria-label="上がったタグ"');
  });

  it.each(["nobot=2", "nobot=yes"])("不正な値（%s）は 400", async (query) => {
    const entityId = await newEntity();
    const res = await SELF.fetch(`${BASE}/p/${entityId}?${query}`);
    expect(res.status).toBe(400);
  });

  it("API でも ?nobot=1 で BOT の票を除いて数える", async () => {
    const entityId = await newEntity();
    await tag(entityId, "BOT が押した", [...n(3, ["up", "bot"]), ["down", "human"]]);
    const res = await SELF.fetch(`${BASE}/api/entities/${entityId}/tags?nobot=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: { up: number; down: number }[] };
    expect(body.tags.map((t) => [t.up, t.down])).toEqual([[0, 1]]);
  });
});

describe("/about", () => {
  it("BOT の票を隠さないことと、除き方を書く", async () => {
    const html = await (await SELF.fetch(`${BASE}/about`)).text();
    expect(html).toContain("<strong>BOT の票</strong>");
    expect(html).toContain("BOT の票は隠さずに数え");
  });
});

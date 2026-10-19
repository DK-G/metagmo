import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, diffTagShares, listTagDiffByView, type ViewTag } from "../src/views";

const tag = (id: string, up: number, down: number): ViewTag => ({
  id,
  entity_id: "e",
  tag_text: id,
  created_at: "2026-10-01T00:00:00.000Z",
  up,
  down,
  score: up - down,
});

const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("diffTagShares: 全体と視界の比率の差", () => {
  it("上がった・下がった・変わらないタグを分ける", () => {
    // 全体: a=6, b=3, c=3（計 12）。視界: a=2, b=1, c=1 → 比率は a=0.5, b=c=0.25 で全体と同じ。
    // そこへ視界で d が増える形にする: 全体 d=0、視界 d=4。
    const all = [tag("a", 6, 0), tag("b", 3, 0), tag("c", 0, 3), tag("d", 0, 0)];
    const inView = [tag("a", 2, 0), tag("b", 1, 0), tag("c", 0, 1), tag("d", 2, 2)];
    const result = diffTagShares(all, inView);
    // 視界の計 8: a=0.25, b=c=0.125, d=0.5。
    expect(ids(result.up)).toEqual(["d"]);
    expect(ids(result.down)).toEqual(["a", "b", "c"]);
    expect(result.same).toEqual([]);
    expect(result.up[0].diff).toBeCloseTo(0.5);
    expect(result.down[0].diff).toBeCloseTo(-0.25);
  });

  it("比率が同じタグは same に入り、diff は 0", () => {
    const all = [tag("a", 2, 0), tag("b", 2, 0), tag("c", 4, 0)];
    const inView = [tag("a", 1, 0), tag("b", 1, 0), tag("c", 2, 0)];
    const result = diffTagShares(all, inView);
    expect(result.up).toEqual([]);
    expect(result.down).toEqual([]);
    expect(ids(result.same)).toEqual(["a", "b", "c"]);
    expect(result.same.every((t) => t.diff === 0)).toBe(true);
  });

  it("3 分の 1 のように小数で割り切れない比率でも、同じなら same", () => {
    const all = [tag("a", 1, 0), tag("b", 1, 0), tag("c", 1, 0)];
    const inView = [tag("a", 3, 0), tag("b", 3, 0), tag("c", 0, 3)];
    expect(ids(diffTagShares(all, inView).same)).toEqual(["a", "b", "c"]);
  });

  it("視界から外れたタグは比率 0 として下がる", () => {
    const all = [tag("a", 3, 0), tag("b", 1, 0)];
    const inView = [tag("a", 3, 0)];
    const result = diffTagShares(all, inView);
    expect(ids(result.up)).toEqual(["a"]);
    expect(ids(result.down)).toEqual(["b"]);
    expect(result.down[0].viewShare).toBe(0);
  });

  it("上段は差の大きい順、下段は下がり幅の大きい順に並ぶ", () => {
    const all = [tag("a", 1, 0), tag("b", 1, 0), tag("c", 4, 0), tag("d", 4, 0)];
    const inView = [tag("a", 3, 0), tag("b", 2, 0), tag("c", 2, 0), tag("d", 3, 0)];
    const result = diffTagShares(all, inView);
    expect(ids(result.up)).toEqual(["a", "b"]);
    expect(ids(result.down)).toEqual(["c", "d"]);
  });

  it("視界に票が 1 つも無いときは比べられないので、すべて same", () => {
    const all = [tag("a", 3, 0), tag("b", 1, 0)];
    const result = diffTagShares(all, []);
    expect(result.up).toEqual([]);
    expect(result.down).toEqual([]);
    expect(ids(result.same)).toEqual(["a", "b"]);
  });

  it("ページに票が 1 つも無いときもすべて same", () => {
    const all = [tag("a", 0, 0)];
    expect(ids(diffTagShares(all, all).same)).toEqual(["a"]);
  });
});

describe("listTagDiffByView（DB から）", () => {
  const NOW = new Date("2026-10-12T12:00:00.000Z");
  const recent = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  it("直近一週間で票が集まったタグが上段、古い票だけのタグが下段に入る", async () => {
    const entityId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(entityId).run();
    const insertTag = async (text: string, voteDates: string[]) => {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text, created_at) VALUES (?, ?, ?, ?)").bind(
          id,
          entityId,
          text,
          old,
        ),
        ...voteDates.map((at) =>
          env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, created_at) VALUES (?, ?, 'up', ?)").bind(
            crypto.randomUUID(),
            id,
            at,
          ),
        ),
      ]);
    };
    await insertTag("新しい", [recent, recent]);
    await insertTag("古い", [old, old]);

    const result = await listTagDiffByView(env.DB, entityId, { ...DEFAULT_VIEW, recent: 1 }, NOW);
    expect(result.up.map((t) => t.tag_text)).toEqual(["新しい"]);
    expect(result.down.map((t) => t.tag_text)).toEqual(["古い"]);
    expect(result.up[0].allShare).toBeCloseTo(0.5);
    expect(result.up[0].viewShare).toBeCloseTo(1);
  });

  it("未押しの視界では全体と同じなので、上段も下段も空", async () => {
    const entityId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(entityId).run();
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text, created_at) VALUES (?, ?, 'x', ?)").bind(id, entityId, old),
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, created_at) VALUES (?, ?, 'up', ?)").bind(
        crypto.randomUUID(),
        id,
        recent,
      ),
    ]);
    const result = await listTagDiffByView(env.DB, entityId, DEFAULT_VIEW, NOW);
    expect(result.up).toEqual([]);
    expect(result.down).toEqual([]);
    expect(result.same.map((t) => t.tag_text)).toEqual(["x"]);
  });
});

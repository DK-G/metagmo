import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, listTagsByView, matchesView, parseViewState, type ViewState } from "../src/views";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs).toISOString();

const view = (over: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW, ...over });

async function newEntity(): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(id).run();
  return id;
}

/** タグを 1 つ作り、[種類, 投票日時] の票を入れる。 */
async function newTag(
  entityId: string,
  text: string,
  votes: ["up" | "down", string][],
  createdAt = daysAgo(30),
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text, created_at) VALUES (?, ?, ?, ?)").bind(
      id,
      entityId,
      text,
      createdAt,
    ),
    ...votes.map(([type, at]) =>
      env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, created_at) VALUES (?, ?, ?, ?)").bind(
        crypto.randomUUID(),
        id,
        type,
        at,
      ),
    ),
  ]);
  return id;
}

const votes = (up: number, down: number, at = daysAgo(1)): ["up" | "down", string][] => [
  ...Array.from({ length: up }, (): ["up", string] => ["up", at]),
  ...Array.from({ length: down }, (): ["down", string] => ["down", at]),
];

const texts = async (entityId: string, v: ViewState) => (await listTagsByView(env.DB, entityId, v, NOW)).map((t) => t.tag_text);

describe("合意（1 回目）: up/(up+down) ≥ 0.7 かつ up+down ≥ 3", () => {
  it.each([
    [7, 3, true, "ちょうど 0.7 は入る"],
    [3, 0, true, "3 票ちょうどは入る"],
    [69, 31, false, "0.69 は入らない"],
    [2, 0, false, "2 票は票数が足りない"],
    [0, 0, false, "0 票は入らない"],
  ])("up=%i down=%i → %s（%s）", (up, down, expected) => {
    expect(matchesView(up, down, { consensus: 1, controversy: 0 })).toBe(expected);
  });
});

describe("合意（2 回目）: down/(up+down) ≥ 0.7 かつ up+down ≥ 3", () => {
  it.each([
    [3, 7, true, "down がちょうど 0.7 は入る"],
    [0, 3, true, "3 票ちょうどは入る"],
    [31, 69, false, "down が 0.69 は入らない"],
    [0, 2, false, "2 票は票数が足りない"],
    [7, 3, false, "賛成側は入らない"],
  ])("up=%i down=%i → %s（%s）", (up, down, expected) => {
    expect(matchesView(up, down, { consensus: 2, controversy: 0 })).toBe(expected);
  });
});

describe("論争（1 回目）: 0.3 ≤ up/(up+down) ≤ 0.7 かつ up+down ≥ 3", () => {
  it.each([
    [3, 7, true, "ちょうど 0.3 は入る"],
    [7, 3, true, "ちょうど 0.7 は入る"],
    [5, 5, true, "半々は入る"],
    [29, 71, false, "0.29 は入らない"],
    [71, 29, false, "0.71 は入らない"],
    [1, 1, false, "2 票は票数が足りない"],
  ])("up=%i down=%i → %s（%s）", (up, down, expected) => {
    expect(matchesView(up, down, { consensus: 0, controversy: 1 })).toBe(expected);
  });
});

describe("論争（2 回目・決着済み）: (up/(up+down) < 0.3 または > 0.7) かつ up+down ≥ 3", () => {
  it.each([
    [71, 29, true, "0.71 は入る"],
    [29, 71, true, "0.29 は入る"],
    [7, 3, false, "ちょうど 0.7 は入らない"],
    [3, 7, false, "ちょうど 0.3 は入らない"],
    [2, 0, false, "比が 1.0 でも 2 票は票数が足りない"],
    [0, 2, false, "比が 0 でも 2 票は票数が足りない"],
  ])("up=%i down=%i → %s（%s）", (up, down, expected) => {
    expect(matchesView(up, down, { consensus: 0, controversy: 2 })).toBe(expected);
  });
});

describe("未押し・重ね押し", () => {
  it("未押しは票数を問わず通す", () => {
    expect(matchesView(0, 0, DEFAULT_VIEW)).toBe(true);
    expect(matchesView(1, 5, DEFAULT_VIEW)).toBe(true);
  });

  it("合意と論争を両方 1 回目にすると、両方に入るちょうど 0.7 だけが残る", () => {
    expect(matchesView(7, 3, { consensus: 1, controversy: 1 })).toBe(true);
    expect(matchesView(8, 2, { consensus: 1, controversy: 1 })).toBe(false);
    expect(matchesView(5, 5, { consensus: 1, controversy: 1 })).toBe(false);
  });
});

describe("既定（全ボタン未押し）", () => {
  it("票の無いタグも含めて全タグを、ネットスコアの大きい順（同点は新しい順）で返す", async () => {
    const entityId = await newEntity();
    await newTag(entityId, "低い", votes(1, 4));
    await newTag(entityId, "高い", votes(5, 1, daysAgo(20)));
    await newTag(entityId, "票なし・古い", [], daysAgo(10));
    await newTag(entityId, "票なし・新しい", [], daysAgo(2));

    const tags = await listTagsByView(env.DB, entityId, DEFAULT_VIEW, NOW);

    expect(tags.map((t) => t.tag_text)).toEqual(["高い", "票なし・新しい", "票なし・古い", "低い"]);
    expect(tags[0]).toMatchObject({ up: 5, down: 1, score: 4, entity_id: entityId });
    expect(tags[3]).toMatchObject({ up: 1, down: 4, score: -3 });
  });

  it("他のページのタグと票は混ざらない", async () => {
    const entityId = await newEntity();
    const other = await newEntity();
    await newTag(entityId, "こちら", votes(2, 0));
    await newTag(other, "あちら", votes(9, 0));

    expect(await texts(entityId, DEFAULT_VIEW)).toEqual(["こちら"]);
  });
});

describe("直近一週間", () => {
  it("1 回目は 7 日以内の票だけを数える（ちょうど 7 日前は入り、それより 1 ミリ秒古い票は入らない）", async () => {
    const entityId = await newEntity();
    await newTag(entityId, "境目", [
      ["up", daysAgo(0)],
      ["up", daysAgo(7)],
      ["down", daysAgo(7, -1)],
      ["down", daysAgo(30)],
    ]);

    const [tag] = await listTagsByView(env.DB, entityId, view({ recent: 1 }), NOW);

    expect(tag).toMatchObject({ up: 2, down: 0, score: 2 });
  });

  it("2 回目は 7 日より前の票だけを数える", async () => {
    const entityId = await newEntity();
    await newTag(entityId, "境目", [
      ["up", daysAgo(0)],
      ["up", daysAgo(7)],
      ["down", daysAgo(7, -1)],
      ["down", daysAgo(30)],
    ]);

    const [tag] = await listTagsByView(env.DB, entityId, view({ recent: 2 }), NOW);

    expect(tag).toMatchObject({ up: 0, down: 2, score: -2 });
  });

  it("並びは絞った後のネットスコアで決まる", async () => {
    const entityId = await newEntity();
    await newTag(entityId, "昔から人気", [...votes(9, 0, daysAgo(20)), ...votes(1, 0, daysAgo(1))]);
    await newTag(entityId, "今週伸びた", [...votes(2, 0, daysAgo(1)), ...votes(0, 1, daysAgo(20))]);

    expect(await texts(entityId, DEFAULT_VIEW)).toEqual(["昔から人気", "今週伸びた"]);
    expect(await texts(entityId, view({ recent: 1 }))).toEqual(["今週伸びた", "昔から人気"]);
    expect(await texts(entityId, view({ recent: 2 }))).toEqual(["昔から人気", "今週伸びた"]);
  });

  it("1 回目・2 回目は、その期間に票の無いタグを返さない（未押しでは返す）", async () => {
    const entityId = await newEntity();
    await newTag(entityId, "昔だけ", votes(3, 0, daysAgo(20)));
    await newTag(entityId, "今週だけ", votes(2, 0, daysAgo(1)));
    await newTag(entityId, "票なし", []);
    // up と down が同数で score が 0 でも、票があれば残る。
    await newTag(entityId, "今週は同数", votes(1, 1, daysAgo(1)), daysAgo(40));

    expect(await texts(entityId, DEFAULT_VIEW)).toEqual(["昔だけ", "今週だけ", "票なし", "今週は同数"]);
    expect(await texts(entityId, view({ recent: 1 }))).toEqual(["今週だけ", "今週は同数"]);
    expect(await texts(entityId, view({ recent: 2 }))).toEqual(["昔だけ"]);
  });
});

describe("集計と絞り込みの組み合わせ（DB から）", () => {
  it("合意・論争の各状態で、条件に合うタグだけが返る", async () => {
    const entityId = await newEntity();
    await newTag(entityId, "賛成多数", votes(8, 2));
    await newTag(entityId, "反対多数", votes(1, 9));
    await newTag(entityId, "割れている", votes(5, 5));
    await newTag(entityId, "票が少ない", votes(2, 0));

    expect(await texts(entityId, view({ consensus: 1 }))).toEqual(["賛成多数"]);
    expect(await texts(entityId, view({ consensus: 2 }))).toEqual(["反対多数"]);
    expect(await texts(entityId, view({ controversy: 1 }))).toEqual(["割れている"]);
    expect(await texts(entityId, view({ controversy: 2 }))).toEqual(["賛成多数", "反対多数"]);
  });

  it("直近一週間と合意を重ねると、比は 7 日以内の票だけで判定する", async () => {
    const entityId = await newEntity();
    // 全期間では 3 対 6 で反対多数、今週だけなら 3 対 0 で合意。
    await newTag(entityId, "今週は賛成", [...votes(3, 0, daysAgo(1)), ...votes(0, 6, daysAgo(20))]);
    // 全期間では 6 対 0 で合意、今週は票が無い。
    await newTag(entityId, "昔は賛成", votes(6, 0, daysAgo(20)));

    expect(await texts(entityId, view({ consensus: 1 }))).toEqual(["昔は賛成"]);
    expect(await texts(entityId, view({ recent: 1, consensus: 1 }))).toEqual(["今週は賛成"]);
    expect(await texts(entityId, view({ recent: 2, consensus: 1 }))).toEqual(["昔は賛成"]);
    expect(await texts(entityId, view({ recent: 2, consensus: 2 }))).toEqual(["今週は賛成"]);
  });
});

describe("クエリの読み取り", () => {
  it("無い項目は未押しになる", () => {
    expect(parseViewState(new URLSearchParams(""))).toEqual({ ok: true, view: DEFAULT_VIEW });
    expect(parseViewState(new URLSearchParams("recent=1&controversy=2"))).toEqual({
      ok: true,
      view: { recent: 1, consensus: 0, controversy: 2 },
    });
  });

  it.each(["recent=3", "consensus=on", "controversy=-1", "recent="])("0・1・2 以外（%s）は不正", (query) => {
    const parsed = parseViewState(new URLSearchParams(query));
    expect(parsed.ok).toBe(false);
  });
});

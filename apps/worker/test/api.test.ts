import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://example.com";

const get = (path: string) => SELF.fetch(`${BASE}${path}`);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

interface Entity {
  id: string;
  title: string;
  summary: string;
}
interface Fact {
  id: string;
  content: string;
  source_url: string;
  source_type: string | null;
  status: string;
}
interface Tag {
  id: string;
  tag_text: string;
  up: number;
  down: number;
  score: number;
}
interface Invalid {
  error: string;
  field: string;
  reason: string;
}

async function newEntity(title = "メタグモ", summary = "タグで見え方を切り替える百科") {
  const res = await post("/api/entities", { title, summary });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: Entity }).entity;
}

async function newTag(entityId: string, tagText: string) {
  const res = await post(`/api/entities/${entityId}/tags`, { tag_text: tagText });
  expect(res.status).toBe(201);
  return ((await res.json()) as { tag: Tag }).tag;
}

async function expectInvalid(res: Response, field: string, reason: string) {
  expect(res.status).toBe(400);
  expect((await res.json()) as Invalid).toEqual({ error: "invalid_input", field, reason });
}

const count = async (sql: string, ...binds: unknown[]) =>
  (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n;

describe("ページ（entities）", () => {
  it("作って、1 件で読める", async () => {
    const entity = await newEntity("  東京タワー  ", "  1958 年に完成した電波塔  ");
    expect(entity.title).toBe("東京タワー");
    expect(entity.summary).toBe("1958 年に完成した電波塔");

    const res = await get(`/api/entities/${entity.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { entity: Entity }).entity).toEqual(entity);
  });

  it("一覧に出る", async () => {
    const entity = await newEntity("一覧に出るページ");
    const res = await get("/api/entities");
    expect(res.status).toBe(200);
    const { entities } = (await res.json()) as { entities: Entity[] };
    expect(entities.map((e) => e.id)).toContain(entity.id);
  });

  it("無い id は 404", async () => {
    const res = await get(`/api/entities/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("タイトルと要約は必須", async () => {
    await expectInvalid(await post("/api/entities", { summary: "s" }), "title", "required");
    await expectInvalid(await post("/api/entities", { title: "   ", summary: "s" }), "title", "required");
    await expectInvalid(await post("/api/entities", { title: "t" }), "summary", "required");
    await expectInvalid(await post("/api/entities", { title: 1, summary: "s" }), "title", "required");
  });

  it("タイトルは 200 字まで", async () => {
    const ok = await post("/api/entities", { title: "あ".repeat(200), summary: "s" });
    expect(ok.status).toBe(201);
    await expectInvalid(await post("/api/entities", { title: "あ".repeat(201), summary: "s" }), "title", "too_long");
  });

  it("JSON でない本文は拒否する", async () => {
    await expectInvalid(await post("/api/entities", "title=x"), "body", "invalid_json");
    await expectInvalid(await post("/api/entities", "[1]"), "body", "invalid_json");
  });

  it("大きすぎる本文は拒否する", async () => {
    const res = await post("/api/entities", { title: "t", summary: "s", pad: "x".repeat(17 * 1024) });
    await expectInvalid(res, "body", "too_large");
  });

  it("作成が履歴に残る", async () => {
    const entity = await newEntity();
    expect(
      await count("SELECT COUNT(*) AS n FROM history WHERE target_type = 'entity' AND target_id = ?", entity.id),
    ).toBe(1);
  });
});

describe("ファクト（facts）", () => {
  it("出典 URL つきで作れて、一覧に出る", async () => {
    const entity = await newEntity();
    const res = await post(`/api/entities/${entity.id}/facts`, {
      content: "高さは 333 メートル",
      source_url: "https://example.com/tower",
      source_type: "公式",
    });
    expect(res.status).toBe(201);
    const { fact } = (await res.json()) as { fact: Fact };
    expect(fact).toMatchObject({
      content: "高さは 333 メートル",
      source_url: "https://example.com/tower",
      source_type: "公式",
      status: "pending_review",
    });

    const list = await get(`/api/entities/${entity.id}/facts`);
    expect(list.status).toBe(200);
    const { facts } = (await list.json()) as { facts: Fact[] };
    expect(facts.map((f) => f.id)).toEqual([fact.id]);
  });

  it("出典の種別は無くてもよい", async () => {
    const entity = await newEntity();
    const res = await post(`/api/entities/${entity.id}/facts`, { content: "c", source_url: "http://example.com/" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { fact: Fact }).fact.source_type).toBeNull();
  });

  it("出典 URL が無いと拒否する", async () => {
    const entity = await newEntity();
    const path = `/api/entities/${entity.id}/facts`;
    await expectInvalid(await post(path, { content: "c" }), "source_url", "required");
    await expectInvalid(await post(path, { content: "c", source_url: "" }), "source_url", "required");
    expect(await count("SELECT COUNT(*) AS n FROM facts WHERE entity_id = ?", entity.id)).toBe(0);
  });

  it("http / https でない出典 URL は拒否する", async () => {
    const entity = await newEntity();
    const path = `/api/entities/${entity.id}/facts`;
    await expectInvalid(await post(path, { content: "c", source_url: "example.com/tower" }), "source_url", "invalid_url");
    await expectInvalid(await post(path, { content: "c", source_url: "javascript:alert(1)" }), "source_url", "invalid_url");
    await expectInvalid(await post(path, { content: "c", source_url: "ftp://example.com/a" }), "source_url", "invalid_url");
  });

  it("本文は必須", async () => {
    const entity = await newEntity();
    await expectInvalid(
      await post(`/api/entities/${entity.id}/facts`, { source_url: "https://example.com/" }),
      "content",
      "required",
    );
  });

  it("無いページへは 404", async () => {
    const id = crypto.randomUUID();
    expect((await get(`/api/entities/${id}/facts`)).status).toBe(404);
    const res = await post(`/api/entities/${id}/facts`, { content: "c", source_url: "https://example.com/" });
    expect(res.status).toBe(404);
  });
});

describe("タグ（tags）", () => {
  it("作れて、票数 0 で一覧に出る", async () => {
    const entity = await newEntity();
    const tag = await newTag(entity.id, "  わかりやすい ");
    expect(tag).toMatchObject({ tag_text: "わかりやすい", up: 0, down: 0, score: 0 });

    const res = await get(`/api/entities/${entity.id}/tags`);
    expect(res.status).toBe(200);
    const { tags } = (await res.json()) as { tags: Tag[] };
    expect(tags).toEqual([tag]);
  });

  it("64 字は入り、65 字は拒否する", async () => {
    const entity = await newEntity();
    const path = `/api/entities/${entity.id}/tags`;
    expect((await post(path, { tag_text: "あ".repeat(64) })).status).toBe(201);
    await expectInvalid(await post(path, { tag_text: "あ".repeat(65) }), "tag_text", "too_long");
    expect(await count("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?", entity.id)).toBe(1);
  });

  it("絵文字も 1 字として数える", async () => {
    const entity = await newEntity();
    const res = await post(`/api/entities/${entity.id}/tags`, { tag_text: "😀".repeat(64) });
    expect(res.status).toBe(201);
  });

  it("空のタグは拒否する", async () => {
    const entity = await newEntity();
    const path = `/api/entities/${entity.id}/tags`;
    await expectInvalid(await post(path, { tag_text: "  " }), "tag_text", "required");
    await expectInvalid(await post(path, {}), "tag_text", "required");
  });

  it("同じページに同じ文言を送ると、増やさずに既存のタグを返す", async () => {
    const entity = await newEntity();
    const first = await newTag(entity.id, "難しい");
    const res = await post(`/api/entities/${entity.id}/tags`, { tag_text: "難しい" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tag: Tag; created: boolean };
    expect(body.created).toBe(false);
    expect(body.tag.id).toBe(first.id);
    expect(await count("SELECT COUNT(*) AS n FROM tags WHERE entity_id = ?", entity.id)).toBe(1);
  });

  it("無いページへは 404", async () => {
    const id = crypto.randomUUID();
    expect((await get(`/api/entities/${id}/tags`)).status).toBe(404);
    expect((await post(`/api/entities/${id}/tags`, { tag_text: "x" })).status).toBe(404);
  });
});

describe("投票（votes）", () => {
  it("up と down が数えられ、score は up - down", async () => {
    const entity = await newEntity();
    const tag = await newTag(entity.id, "賛否");
    const path = `/api/tags/${tag.id}/vote`;

    await post(path, { vote_type: "up" });
    await post(path, { vote_type: "up" });
    const res = await post(path, { vote_type: "down" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { tag: Tag }).tag).toMatchObject({ up: 2, down: 1, score: 1 });
  });

  it("タグの一覧は score の大きい順", async () => {
    const entity = await newEntity();
    const low = await newTag(entity.id, "低い");
    const high = await newTag(entity.id, "高い");
    const mid = await newTag(entity.id, "中くらい");
    await post(`/api/tags/${low.id}/vote`, { vote_type: "down" });
    await post(`/api/tags/${high.id}/vote`, { vote_type: "up" });

    const { tags } = (await (await get(`/api/entities/${entity.id}/tags`)).json()) as { tags: Tag[] };
    expect(tags.map((t) => t.id)).toEqual([high.id, mid.id, low.id]);
    expect(tags.map((t) => t.score)).toEqual([1, 0, -1]);
  });

  it("up / down 以外は拒否する", async () => {
    const entity = await newEntity();
    const tag = await newTag(entity.id, "x");
    const path = `/api/tags/${tag.id}/vote`;
    await expectInvalid(await post(path, { vote_type: "maybe" }), "vote_type", "invalid");
    await expectInvalid(await post(path, {}), "vote_type", "invalid");
    expect(await count("SELECT COUNT(*) AS n FROM votes WHERE tag_id = ?", tag.id)).toBe(0);
  });

  it("無いタグへは 404", async () => {
    const res = await post(`/api/tags/${crypto.randomUUID()}/vote`, { vote_type: "up" });
    expect(res.status).toBe(404);
  });

  it("送信元の IP を票に残す", async () => {
    const entity = await newEntity();
    const tag = await newTag(entity.id, "x");
    await post(`/api/tags/${tag.id}/vote`, { vote_type: "up" }, { "CF-Connecting-IP": "203.0.113.7" });
    const row = await env.DB.prepare("SELECT ip_address FROM votes WHERE tag_id = ?")
      .bind(tag.id)
      .first<{ ip_address: string | null }>();
    expect(row?.ip_address).toBe("203.0.113.7");
  });
});

describe("タグの一覧と視界 3 ボタン", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

  /** 票を日時つきで直に入れる（API の投票は「今」の票しか作れないため）。 */
  async function castVotes(tagId: string, up: number, down: number, at: string) {
    const types = [...Array<string>(up).fill("up"), ...Array<string>(down).fill("down")];
    if (types.length === 0) return;
    await env.DB.batch(
      types.map((type) =>
        env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, created_at) VALUES (?, ?, ?, ?)").bind(
          crypto.randomUUID(),
          tagId,
          type,
          at,
        ),
      ),
    );
  }

  /** 視界ごとに返るタグが変わるよう、票の付き方が違う 5 つのタグを持つページを作る。 */
  async function seeded() {
    const entity = await newEntity();
    const add = async (text: string, recent: [number, number], old: [number, number]) => {
      const tag = await newTag(entity.id, text);
      await castVotes(tag.id, recent[0], recent[1], daysAgo(1));
      await castVotes(tag.id, old[0], old[1], daysAgo(20));
    };
    await add("今週は賛成", [8, 2], [0, 0]);
    await add("今週は反対", [1, 9], [0, 0]);
    await add("今週は割れた", [5, 5], [0, 0]);
    await add("昔は賛成", [0, 0], [6, 0]);
    await add("票なし", [0, 0], [0, 0]);
    return entity;
  }

  const sorted = (...names: string[]) => names.sort();
  const texts = async (entityId: string, query = "") => {
    const res = await get(`/api/entities/${entityId}/tags${query}`);
    expect(res.status).toBe(200);
    return sorted(...((await res.json()) as { tags: Tag[] }).tags.map((t) => t.tag_text));
  };

  it("未押し（クエリなし・0）は票の無いタグも含めて全部返す", async () => {
    const entity = await seeded();
    const all = sorted("今週は賛成", "今週は反対", "今週は割れた", "昔は賛成", "票なし");
    expect(await texts(entity.id)).toEqual(all);
    expect(await texts(entity.id, "?recent=0&consensus=0&controversy=0")).toEqual(all);
  });

  it("直近一週間: 1 回目は今週の票があるタグ、2 回目はそれより前の票があるタグだけ（0 票のタグは返らない）", async () => {
    const entity = await seeded();
    expect(await texts(entity.id, "?recent=1")).toEqual(sorted("今週は賛成", "今週は反対", "今週は割れた"));
    expect(await texts(entity.id, "?recent=2")).toEqual(["昔は賛成"]);
  });

  it("合意: 1 回目は賛成多数、2 回目は反対多数", async () => {
    const entity = await seeded();
    expect(await texts(entity.id, "?consensus=1")).toEqual(sorted("今週は賛成", "昔は賛成"));
    expect(await texts(entity.id, "?consensus=2")).toEqual(["今週は反対"]);
  });

  it("論争: 1 回目は割れているタグ、2 回目は決着済みのタグ", async () => {
    const entity = await seeded();
    expect(await texts(entity.id, "?controversy=1")).toEqual(["今週は割れた"]);
    expect(await texts(entity.id, "?controversy=2")).toEqual(sorted("今週は賛成", "今週は反対", "昔は賛成"));
  });

  it("重ね押しは「かつ」で絞り、票数は絞った期間のものを返す", async () => {
    const entity = await seeded();
    expect(await texts(entity.id, "?recent=1&consensus=1")).toEqual(["今週は賛成"]);
    expect(await texts(entity.id, "?recent=2&consensus=1")).toEqual(["昔は賛成"]);

    const res = await get(`/api/entities/${entity.id}/tags?recent=1&consensus=1`);
    const { tags } = (await res.json()) as { tags: Tag[] };
    expect(tags[0]).toMatchObject({ tag_text: "今週は賛成", up: 8, down: 2, score: 6 });
  });

  it.each([
    ["recent=3", "recent"],
    ["consensus=on", "consensus"],
    ["controversy=-1", "controversy"],
    ["recent=", "recent"],
    ["recent=1&controversy=9", "controversy"],
  ])("0・1・2 以外（%s）は 400", async (query, field) => {
    const entity = await newEntity();
    await expectInvalid(await get(`/api/entities/${entity.id}/tags?${query}`), field, "invalid");
  });

  it("無いページは、クエリが不正でも 404", async () => {
    const res = await get(`/api/entities/${crypto.randomUUID()}/tags?recent=9`);
    expect(res.status).toBe(404);
  });

  it("タグを作る POST は視界のクエリを見ない", async () => {
    const entity = await newEntity();
    const res = await post(`/api/entities/${entity.id}/tags?recent=9`, { tag_text: "x" });
    expect(res.status).toBe(201);
  });
});

describe("経路", () => {
  it("知らない経路は 404", async () => {
    expect((await get("/api/unknown")).status).toBe(404);
    expect((await get("/api/entities/a/b/c")).status).toBe(404);
    expect((await get(`/api/tags/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it("対応していないメソッドは 405", async () => {
    const res = await SELF.fetch(`${BASE}/api/entities`, { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, POST");

    const vote = await get(`/api/tags/${crypto.randomUUID()}/vote`);
    expect(vote.status).toBe(405);
  });
});

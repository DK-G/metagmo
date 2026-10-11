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

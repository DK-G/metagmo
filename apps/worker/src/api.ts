// R1-2 API（認証なし）。ページ・ファクト・タグ・投票の基本操作。
// 一覧は q の部分一致検索と sort を受ける。タグは視界 3 ボタンも重ねられる（views.ts）。

import type { Env } from "./index";
import { InputError, LIMITS, optionalText, requiredHttpUrl, requiredText, voteType } from "./validate";
import { listTagsByView, parseViewState } from "./views";
import { parseSearch } from "./search";

const MAX_BODY_BYTES = 16 * 1024;
const LIST_LIMIT = 100;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ error: "not_found" }, 404);
const methodNotAllowed = (allow: string) =>
  Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: allow } });

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new InputError("body", "too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InputError("body", "invalid_json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputError("body", "invalid_json");
  }
  return parsed as Record<string, unknown>;
}

// 簡易アクションログ（仕様 2.1 の非機能）。本体の書き込みと同じ batch に入れる。
function historyRow(env: Env, action: string, targetType: string, targetId: string, details: unknown) {
  return env.DB.prepare(
    "INSERT INTO history (id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), action, targetType, targetId, JSON.stringify(details));
}

async function entityExists(env: Env, id: string): Promise<boolean> {
  return (await env.DB.prepare("SELECT 1 AS ok FROM entities WHERE id = ?").bind(id).first()) !== null;
}

const ENTITY_COLUMNS = "id, title, summary, created_at, updated_at";
const FACT_COLUMNS = "id, entity_id, content, source_url, source_type, status, created_at, updated_at";

// タグ 1 件と票数（全期間）。一覧は views.ts の listTagsByView が返す。
const TAG_WITH_COUNTS = `
  SELECT t.id, t.entity_id, t.tag_text, t.created_at,
         COALESCE(SUM(v.vote_type = 'up'), 0) AS up,
         COALESCE(SUM(v.vote_type = 'down'), 0) AS down
  FROM tags t LEFT JOIN votes v ON v.tag_id = t.id`;

interface TagRow {
  id: string;
  entity_id: string;
  tag_text: string;
  created_at: string;
  up: number;
  down: number;
}

const withScore = (row: TagRow) => ({ ...row, score: row.up - row.down });

async function tagById(env: Env, id: string) {
  const row = await env.DB.prepare(`${TAG_WITH_COUNTS} WHERE t.id = ? GROUP BY t.id`).bind(id).first<TagRow>();
  return row ? withScore(row) : null;
}

async function listEntities(env: Env, params: URLSearchParams) {
  const { q, sort } = parseSearch(params, "newest");
  const order = sort === "score_desc" ? "score DESC, e.created_at DESC, e.id" : "e.created_at DESC, e.id";
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.title, e.summary, e.created_at, e.updated_at,
       (SELECT COALESCE(SUM(CASE v.vote_type WHEN 'up' THEN 1 ELSE -1 END), 0)
        FROM tags t JOIN votes v ON v.tag_id = t.id WHERE t.entity_id = e.id) AS score
     FROM entities e
     WHERE ?1 = '' OR instr(lower(e.title), lower(?1)) > 0
       OR EXISTS (SELECT 1 FROM tags t WHERE t.entity_id = e.id AND instr(lower(t.tag_text), lower(?1)) > 0)
     ORDER BY ${order} LIMIT ?2`,
  )
    .bind(q, LIST_LIMIT)
    .all();
  return json({ entities: results });
}

async function createEntity(request: Request, env: Env) {
  const body = await readBody(request);
  const title = requiredText(body, "title", LIMITS.title);
  const summary = requiredText(body, "summary", LIMITS.summary);

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, ?, ?)").bind(id, title, summary),
    historyRow(env, "create", "entity", id, { title }),
  ]);
  const entity = await env.DB.prepare(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = ?`).bind(id).first();
  return json({ entity }, 201);
}

async function getEntity(env: Env, id: string) {
  const entity = await env.DB.prepare(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = ?`).bind(id).first();
  return entity ? json({ entity }) : notFound();
}

async function listFacts(env: Env, entityId: string) {
  if (!(await entityExists(env, entityId))) return notFound();
  const { results } = await env.DB.prepare(
    `SELECT ${FACT_COLUMNS} FROM facts WHERE entity_id = ? ORDER BY created_at, id`,
  )
    .bind(entityId)
    .all();
  return json({ facts: results });
}

async function createFact(request: Request, env: Env, entityId: string) {
  if (!(await entityExists(env, entityId))) return notFound();
  const body = await readBody(request);
  const content = requiredText(body, "content", LIMITS.factContent);
  const sourceUrl = requiredHttpUrl(body, "source_url", LIMITS.sourceUrl);
  const sourceType = optionalText(body, "source_type", LIMITS.sourceType);

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO facts (id, entity_id, content, source_url, source_type) VALUES (?, ?, ?, ?, ?)").bind(
      id,
      entityId,
      content,
      sourceUrl,
      sourceType,
    ),
    historyRow(env, "create", "fact", id, { entity_id: entityId, source_url: sourceUrl }),
  ]);
  const fact = await env.DB.prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = ?`).bind(id).first();
  return json({ fact }, 201);
}

// `?recent=`・`?consensus=`・`?controversy=` に 0/1/2 を受ける。無い項目は未押し。
async function listTags(env: Env, entityId: string, params: URLSearchParams) {
  if (!(await entityExists(env, entityId))) return notFound();
  const parsed = parseViewState(params);
  if (!parsed.ok) throw new InputError(parsed.field, "invalid");
  const search = parseSearch(params, "score_desc");
  return json({ tags: await listTagsByView(env.DB, entityId, parsed.view, new Date(), search) });
}

async function createTag(request: Request, env: Env, entityId: string) {
  if (!(await entityExists(env, entityId))) return notFound();
  const body = await readBody(request);
  const tagText = requiredText(body, "tag_text", LIMITS.tagText);

  // 同じページに同じ文言のタグが既にあれば、増やさずにそれを返す（票が割れないように）。
  // 先に探してから入れると、同時に 2 件来た時に両方が「まだ無い」を見て 2 行できる。
  // そこでまず入れ、表の一意制約（migrations/0002）で弾かれたら既にある行を返す。
  // batch は 1 つの transaction なので、弾かれた時は履歴の行も残らない。
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text) VALUES (?, ?, ?)").bind(id, entityId, tagText),
      historyRow(env, "create", "tag", id, { entity_id: entityId, tag_text: tagText }),
    ]);
  } catch (error) {
    if (!String(error).includes("UNIQUE constraint failed")) throw error;
    const existing = await env.DB.prepare("SELECT id FROM tags WHERE entity_id = ? AND tag_text = ?")
      .bind(entityId, tagText)
      .first<{ id: string }>();
    if (!existing) throw error;
    return json({ tag: await tagById(env, existing.id), created: false });
  }
  return json({ tag: await tagById(env, id), created: true }, 201);
}

async function createVote(request: Request, env: Env, tagId: string) {
  const exists = await env.DB.prepare("SELECT 1 AS ok FROM tags WHERE id = ?").bind(tagId).first();
  if (!exists) return notFound();
  const body = await readBody(request);
  const type = voteType(body, "vote_type");

  // 匿名の票は同じタグへ何票でも入る（表の定義どおり）。IP は荒らし対策（Q-007）用に残す。
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO votes (id, tag_id, ip_address, vote_type) VALUES (?, ?, ?, ?)").bind(
      id,
      tagId,
      request.headers.get("CF-Connecting-IP"),
      type,
    ),
    historyRow(env, "vote", "tag", tagId, { vote_id: id, vote_type: type }),
  ]);
  return json({ tag: await tagById(env, tagId) }, 201);
}

async function route(request: Request, env: Env, segments: string[]): Promise<Response> {
  const method = request.method;
  const params = new URL(request.url).searchParams;
  const [resource, id, sub, ...rest] = segments;
  if (rest.length > 0) return notFound();

  if (resource === "entities") {
    if (id === undefined) {
      if (method === "GET") return listEntities(env, params);
      if (method === "POST") return createEntity(request, env);
      return methodNotAllowed("GET, POST");
    }
    if (sub === undefined) {
      if (method === "GET") return getEntity(env, id);
      return methodNotAllowed("GET");
    }
    if (sub === "facts") {
      if (method === "GET") return listFacts(env, id);
      if (method === "POST") return createFact(request, env, id);
      return methodNotAllowed("GET, POST");
    }
    if (sub === "tags") {
      if (method === "GET") return listTags(env, id, params);
      if (method === "POST") return createTag(request, env, id);
      return methodNotAllowed("GET, POST");
    }
    return notFound();
  }

  if (resource === "tags" && id !== undefined && sub === "vote") {
    if (method === "POST") return createVote(request, env, id);
    return methodNotAllowed("POST");
  }

  return notFound();
}

/** `/api/` より後ろの経路を受ける。 */
export async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const segments = pathname.split("/").filter((s) => s !== "");
  try {
    return await route(request, env, segments);
  } catch (e) {
    if (e instanceof InputError) return json({ error: "invalid_input", field: e.field, reason: e.reason }, 400);
    throw e;
  }
}

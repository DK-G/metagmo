// 書く側の画面の経路（Q-013〜）。フォーム（application/x-www-form-urlencoded）で受け、
// API と同じ検証・流量制限（guard.ts の checkWrite）に通す。トークンは項目 cf-turnstile-response。
// 成功は 303 で元のページへ戻し、失敗は理由を 1 行出した同じページを返す。

import type { Env } from "./index";
import { insertFact, insertTag, insertVote } from "./api";
import { checkWrite } from "./guard";
import { pageResponse } from "./page";
import { insertReport, parseReportTarget, targetOnPage } from "./reports";
import { notFoundResponse } from "./site-pages";
import { InputError, LIMITS, optionalText, requiredHttpUrl, requiredText, voteType } from "./validate";
import { viewQuery } from "./view-buttons";
import { parseViewState } from "./views";
import { factInputMessage, rejectionMessage, REPORT_INPUT_MESSAGE, tagInputMessage, TURNSTILE_FIELD, VOTE_INPUT_MESSAGE } from "./write-forms";

/** フォームの項目を文字列だけの表にする。読めない本文は空の表（必須の項目で 400 になる）。 */
async function readForm(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string" && !(key in out)) out[key] = value;
    }
  } catch {
    // 本文がフォームでない
  }
  return out;
}

const seeOther = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

/** `POST /p/:id/tags`。タグを 1 つ足して `/p/:id` へ戻す。 */
export async function handleTagForm(request: Request, env: Env, entityId: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const exists = await env.DB.prepare("SELECT 1 AS ok FROM entities WHERE id = ?").bind(entityId).first();
  if (!exists) return pageResponse(request, env, entityId);

  const form = await readForm(request);
  const typed = form.tag_text ?? "";

  const rejected = await checkWrite(request, env, "post", form[TURNSTILE_FIELD] ?? null);
  if (rejected) {
    const res = await pageResponse(request, env, entityId, { message: rejectionMessage(rejected), value: typed }, rejected.status);
    if (rejected.retryAfter !== undefined) res.headers.set("Retry-After", String(rejected.retryAfter));
    return res;
  }

  let tagText: string;
  try {
    tagText = requiredText(form, "tag_text", LIMITS.tagText);
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return pageResponse(request, env, entityId, { message: tagInputMessage(e.reason), value: typed }, 400);
  }

  await insertTag(env, entityId, tagText);
  return seeOther(`/p/${encodeURIComponent(entityId)}`);
}

/**
 * `POST /p/:id/tags/:tagId/vote`（Q-014）。票を 1 つ入れ、押した時の視界の URL（`?consensus=1` など）へ 303 で戻す。
 * 視界は送り先（ボタンの formaction）の URL の値で受ける。ボタンはタグのフォームの Turnstile を使う（write-forms.ts）。
 */
export async function handleVoteForm(request: Request, env: Env, entityId: string, tagId: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  // 別ページのタグ id は、ページが無いのと同じ 404（経路違いは守りより先に返す）。
  const tag = await env.DB.prepare("SELECT 1 AS ok FROM tags WHERE id = ? AND entity_id = ?").bind(tagId, entityId).first();
  if (!tag) return notFoundResponse();
  // 視界の値が不正なら、ページと同じ 400 の HTML（票は入れない）。
  const parsed = parseViewState(new URL(request.url).searchParams);
  if (!parsed.ok) return pageResponse(request, env, entityId);

  const form = await readForm(request);

  const rejected = await checkWrite(request, env, "vote", form[TURNSTILE_FIELD] ?? null);
  if (rejected) {
    const res = await pageResponse(request, env, entityId, { message: rejectionMessage(rejected) }, rejected.status);
    if (rejected.retryAfter !== undefined) res.headers.set("Retry-After", String(rejected.retryAfter));
    return res;
  }

  let type: "up" | "down";
  try {
    type = voteType(form, "vote_type");
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return pageResponse(request, env, entityId, { message: VOTE_INPUT_MESSAGE }, 400);
  }

  await insertVote(request, env, tagId, type);
  return seeOther(`/p/${encodeURIComponent(entityId)}${viewQuery(parsed.view)}`);
}

/**
 * `POST /p/:id/facts`（Q-015）。ファクトを 1 つ足して `/p/:id` へ戻す。出典 URL は必須で http(s) だけ（API と同じ検査）。
 * 失敗は理由の 1 行と入力値をファクトのフォームの位置に出す。
 */
export async function handleFactForm(request: Request, env: Env, entityId: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const exists = await env.DB.prepare("SELECT 1 AS ok FROM entities WHERE id = ?").bind(entityId).first();
  if (!exists) return pageResponse(request, env, entityId);

  const form = await readForm(request);
  const fields = {
    content: form.content ?? "",
    source_url: form.source_url ?? "",
    source_type: form.source_type ?? "",
  };

  const rejected = await checkWrite(request, env, "post", form[TURNSTILE_FIELD] ?? null);
  if (rejected) {
    const notice = { form: "fact" as const, message: rejectionMessage(rejected), fields };
    const res = await pageResponse(request, env, entityId, notice, rejected.status);
    if (rejected.retryAfter !== undefined) res.headers.set("Retry-After", String(rejected.retryAfter));
    return res;
  }

  let content: string;
  let sourceUrl: string;
  let sourceType: string | null;
  try {
    content = requiredText(form, "content", LIMITS.factContent);
    sourceUrl = requiredHttpUrl(form, "source_url", LIMITS.sourceUrl);
    sourceType = optionalText(form, "source_type", LIMITS.sourceType);
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    const notice = { form: "fact" as const, message: factInputMessage(e.field, e.reason), fields };
    return pageResponse(request, env, entityId, notice, 400);
  }

  await insertFact(env, entityId, content, sourceUrl, sourceType);
  return seeOther(`/p/${encodeURIComponent(entityId)}`);
}

/**
 * `POST /p/:id/report`（Q-021・D-016）。タグかファクトへの通報を 1 件入れ、`/p/:id?reported=1` へ 303 で戻す。
 * 対象は項目 target の `tag:<id>`・`fact:<id>`。ボタンはタグかファクトのフォームの Turnstile を form 属性で使う（write-forms.ts）。
 * 検証・流量はタグのフォームと同じ post 枠。通報が 3 件集まった対象は reports.ts の条件で隠れる。
 */
export async function handleReportForm(request: Request, env: Env, entityId: string): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const exists = await env.DB.prepare("SELECT 1 AS ok FROM entities WHERE id = ?").bind(entityId).first();
  if (!exists) return notFoundResponse();

  const form = await readForm(request);
  const target = parseReportTarget(form.target);
  if (target === null) return pageResponse(request, env, entityId, { message: REPORT_INPUT_MESSAGE }, 400);
  // 別ページのタグ・ファクトの id は、無いのと同じ 404（経路違いは守りより先に返す。票と同じ）。
  if (!(await targetOnPage(env, entityId, target.type, target.id))) return notFoundResponse();

  const rejected = await checkWrite(request, env, "post", form[TURNSTILE_FIELD] ?? null);
  if (rejected) {
    const notice = target.type === "fact" ? { form: "fact" as const, message: rejectionMessage(rejected) } : { message: rejectionMessage(rejected) };
    const res = await pageResponse(request, env, entityId, notice, rejected.status);
    if (rejected.retryAfter !== undefined) res.headers.set("Retry-After", String(rejected.retryAfter));
    return res;
  }

  await insertReport(request, env, target.type, target.id);
  return seeOther(`/p/${encodeURIComponent(entityId)}?reported=1`);
}

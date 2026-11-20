// 書く側の画面の経路（Q-013〜）。フォーム（application/x-www-form-urlencoded）で受け、
// API と同じ検証・流量制限（guard.ts の checkWrite）に通す。トークンは項目 cf-turnstile-response。
// 成功は 303 で元のページへ戻し、失敗は理由を 1 行出した同じページを返す。

import type { Env } from "./index";
import { insertTag, insertVote } from "./api";
import { checkWrite } from "./guard";
import { pageResponse } from "./page";
import { notFoundResponse } from "./site-pages";
import { InputError, LIMITS, requiredText, voteType } from "./validate";
import { viewQuery } from "./view-buttons";
import { parseViewState } from "./views";
import { rejectionMessage, tagInputMessage, TURNSTILE_FIELD, VOTE_INPUT_MESSAGE } from "./write-forms";

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

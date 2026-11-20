// 書く側の画面の経路（Q-013〜）。フォーム（application/x-www-form-urlencoded）で受け、
// API と同じ検証・流量制限（guard.ts の checkWrite）に通す。トークンは項目 cf-turnstile-response。
// 成功は 303 で元のページへ戻し、失敗は理由を 1 行出した同じページを返す。

import type { Env } from "./index";
import { insertFact, insertTag } from "./api";
import { checkWrite } from "./guard";
import { pageResponse } from "./page";
import { InputError, LIMITS, optionalText, requiredHttpUrl, requiredText } from "./validate";
import { factInputMessage, rejectionMessage, tagInputMessage, TURNSTILE_FIELD } from "./write-forms";

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

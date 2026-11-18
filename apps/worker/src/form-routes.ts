// 書く側の画面の経路（Q-013〜）。フォーム（application/x-www-form-urlencoded）で受け、
// API と同じ検証・流量制限（guard.ts の checkWrite）に通す。トークンは項目 cf-turnstile-response。
// 成功は 303 で元のページへ戻し、失敗は理由を 1 行出した同じページを返す。

import type { Env } from "./index";
import { insertTag } from "./api";
import { checkWrite } from "./guard";
import { pageResponse } from "./page";
import { InputError, LIMITS, requiredText } from "./validate";
import { rejectionMessage, tagInputMessage, TURNSTILE_FIELD } from "./write-forms";

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

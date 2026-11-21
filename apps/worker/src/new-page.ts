// ページを作る画面（Q-016）: `GET /new` でタイトル・要約のフォームを出し、`POST /new` で作って新しい `/p/:id` へ 303。
// 書き込みは他のフォームと同じく guard.ts の checkWrite（流量制限＋Turnstile）を通し、作るのは api.ts の insertEntity（API と共有）。
// 失敗は理由の 1 行と入力値をつけて同じフォームを返す。見た目は脇のページ（site-pages.ts）とファクトのフォームの部品を使う。

import type { Env } from "./index";
import { insertEntity } from "./api";
import { checkWrite } from "./guard";
import { escapeHtml } from "./page";
import { PAGE_CSS } from "./page-css";
import { SITE_CSS, SITE_FOOTER } from "./site-pages";
import { InputError, LIMITS, requiredText } from "./validate";
import { FORM_CSS, rejectionMessage, TURNSTILE_FIELD, TURNSTILE_SCRIPT, turnstileWidget } from "./write-forms";

/** フォームに戻す 1 行と入力値。 */
export interface NewPageNotice {
  message: string;
  fields: { title: string; summary: string };
}

/** 入力の誤りを、画面に出す 1 行にする。 */
export function newPageInputMessage(field: string, reason: string): string {
  if (field === "title") {
    return reason === "too_long" ? `タイトルは ${LIMITS.title} 字までです。` : "タイトルを入力してください。";
  }
  return reason === "too_long" ? `要約は ${LIMITS.summary} 字までです。` : "要約を入力してください。";
}

const NEW_PAGE_CSS = `
.new-page-form {
  display: grid;
  gap: 10px;
}

.new-page-form label {
  margin-top: 6px;
}
`;

/** `/new` の HTML。検索に載せる中身は無いので noindex。 */
export function renderNewPage(siteKey: string | undefined, notice: NewPageNotice | null = null): string {
  const error = notice ? `<p class="form-error" role="alert">${escapeHtml(notice.message)}</p>` : "";
  const title = notice?.fields.title ? ` value="${escapeHtml(notice.fields.title)}"` : "";
  const summary = escapeHtml(notice?.fields.summary ?? "");
  const lead = "調べたい物事のページを 1 つ作ります。作った後に、ファクトとタグを足していきます。";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ページを作る | メタグモ</title>
<meta name="description" content="${escapeHtml(lead)}">
<meta name="robots" content="noindex">
<style>${PAGE_CSS}${FORM_CSS}${SITE_CSS}${NEW_PAGE_CSS}</style>
</head>
<body>
<main class="app-shell">
<header class="topbar">
<a class="brand" href="/" aria-label="メタグモ ホーム"><span class="brand-mark">M</span><span>メタグモ</span></a>
</header>
<section class="entity-hero" id="top">
<div><h1>ページを作る</h1><p>${escapeHtml(lead)}</p></div>
</section>
<section class="prose-panel">
<div class="facts-panel">
<form class="fact-form new-page-form" id="new-page-form" method="post" action="/new">
${error}<label for="new-title">タイトル</label>
<input id="new-title" name="title" maxlength="${LIMITS.title}" required placeholder="例: 〇〇市の新しい図書館計画"${title}>
<label for="new-summary">要約</label>
<p class="form-note">何についてのページかを 1〜2 文で。良い・悪いの判断は書かず、それはタグで表します。</p>
<textarea id="new-summary" name="summary" rows="3" maxlength="${LIMITS.summary}" required placeholder="このページで扱う物事を短く説明">${summary}</textarea>
<button type="submit">ページを作る</button>
${turnstileWidget(siteKey)}
</form>
${siteKey ? TURNSTILE_SCRIPT : ""}
</div>
</section>
${SITE_FOOTER}
</main>
</body>
</html>`;
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

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

/** `/new` を受ける。GET はフォーム、POST は作って `/p/:id` へ 303。 */
export async function handleNewPage(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return html(renderNewPage(env.TURNSTILE_SITE_KEY));
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }

  const form = await readForm(request);
  const fields = { title: form.title ?? "", summary: form.summary ?? "" };

  const rejected = await checkWrite(request, env, "post", form[TURNSTILE_FIELD] ?? null);
  if (rejected) {
    const res = html(renderNewPage(env.TURNSTILE_SITE_KEY, { message: rejectionMessage(rejected), fields }), rejected.status);
    if (rejected.retryAfter !== undefined) res.headers.set("Retry-After", String(rejected.retryAfter));
    return res;
  }

  let title: string;
  let summary: string;
  try {
    title = requiredText(form, "title", LIMITS.title);
    summary = requiredText(form, "summary", LIMITS.summary);
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return html(renderNewPage(env.TURNSTILE_SITE_KEY, { message: newPageInputMessage(e.field, e.reason), fields }), 400);
  }

  const id = await insertEntity(env, title, summary);
  return new Response(null, { status: 303, headers: { Location: `/p/${encodeURIComponent(id)}` } });
}

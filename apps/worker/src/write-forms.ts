// 書く側の画面の部品（Q-013〜）。HTML とその見た目だけを置き、経路は form-routes.ts。
// フォームは JS なしで送れる形（action と method だけ）。JS は Turnstile のウィジェットだけ。
// ウィジェットはフォームの中に項目 cf-turnstile-response を足し、送信で一緒に届く。

import type { WriteRejection } from "./guard";
import { LIMITS } from "./validate";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** フォームの項目名。Turnstile のウィジェットが入れる名前に合わせる。 */
export const TURNSTILE_FIELD = "cf-turnstile-response";

const TURNSTILE_SCRIPT = `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;

/**
 * 送った後に同じページで出す 1 行と、入力欄に戻す値。
 * form が "fact" ならファクトのフォーム（Q-015）の位置に出し、入力値は fields に入れる。無ければタグのフォーム。
 */
export interface FormNotice {
  message: string;
  value?: string;
  form?: "tag" | "fact";
  fields?: Record<string, string>;
}

/** 書き込みの拒否を、画面に出す 1 行にする。 */
export function rejectionMessage(rejected: WriteRejection): string {
  switch (rejected.error) {
    case "rate_limited": {
      const minutes = Math.max(1, Math.ceil((rejected.retryAfter ?? 60) / 60));
      return `短い間に送った回数が上限を超えました。${minutes} 分ほど待ってからもう一度送ってください。`;
    }
    case "turnstile_failed":
      return "ロボットでないことの確認が済んでいないか、期限が切れました。確認をやり直してから送ってください。";
    case "ip_hash_not_configured":
    case "turnstile_not_configured":
      return "いまは書き込みを受け付けていません（サイトの設定の準備中です）。";
  }
}

/** 入力の誤りを、画面に出す 1 行にする。 */
export function tagInputMessage(reason: string): string {
  if (reason === "too_long") return `タグは ${LIMITS.tagText} 字までです。`;
  return "タグを入力してください。";
}

/** Turnstile のウィジェット。サイトキーが無ければ置かない（送っても 403 になる）。 */
function turnstileWidget(siteKey: string | undefined): string {
  if (!siteKey) return "";
  return `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-language="ja"></div>`;
}

/** `/p/:id` の下に置く、タグを足すフォーム。 */
export function renderTagForm(entityId: string, siteKey: string | undefined, notice: FormNotice | null = null): string {
  const action = `/p/${encodeURIComponent(entityId)}/tags`;
  const error = notice ? `<p class="form-error" role="alert">${esc(notice.message)}</p>` : "";
  const value = notice?.value ? ` value="${esc(notice.value)}"` : "";
  return `<form class="tag-form" id="tag-form" method="post" action="${esc(action)}">
<label for="tag-input">タグを追加</label>
${error}<div>
<input id="tag-input" name="tag_text" maxlength="${LIMITS.tagText}" required placeholder="例: 出典確認が前提"${value}>
<button type="submit">投稿</button>
</div>
${turnstileWidget(siteKey)}
</form>
${siteKey ? TURNSTILE_SCRIPT : ""}`;
}

/** 出典の種別の選択肢（migrations/0001_init.sql の source_type の例）。空は「選ばない」。 */
export const SOURCE_TYPES = ["公式", "一次", "二次"] as const;

/** ファクトの入力の誤りを、画面に出す 1 行にする（Q-015）。field は InputError の項目名。 */
export function factInputMessage(field: string, reason: string): string {
  if (field === "content") {
    return reason === "too_long" ? `ファクトは ${LIMITS.factContent} 字までです。` : "ファクトの本文を入力してください。";
  }
  if (field === "source_url") {
    if (reason === "too_long") return `出典 URL は ${LIMITS.sourceUrl} 字までです。`;
    if (reason === "invalid_url") return "出典 URL は http:// か https:// で始まる URL にしてください。";
    return "出典 URL を入力してください（出典の無いファクトは載せません）。";
  }
  return "出典の種別の指定が正しくありません。";
}

/**
 * `/p/:id` の Facts の下に置く、ファクトを足すフォーム（Q-015）。
 * Turnstile の読み込みはタグのフォームの script に任せ、ここはウィジェットだけ置く（同じページに 2 つ目の script を置かない）。
 */
export function renderFactForm(entityId: string, siteKey: string | undefined, notice: FormNotice | null = null): string {
  const action = `/p/${encodeURIComponent(entityId)}/facts`;
  const error = notice ? `<p class="form-error" role="alert">${esc(notice.message)}</p>` : "";
  const fields = notice?.fields ?? {};
  const url = fields.source_url ? ` value="${esc(fields.source_url)}"` : "";
  const chosen = fields.source_type ?? "";
  const options = ["", ...SOURCE_TYPES]
    .map((t) => `<option value="${esc(t)}"${t === chosen ? " selected" : ""}>${t === "" ? "種別を選ばない" : esc(t)}</option>`)
    .join("");
  return `<form class="fact-form" id="fact-form" method="post" action="${esc(action)}">
<label for="fact-content">ファクトを追加</label>
<p class="form-note">確かめられる事実だけを書き、良い・悪いの判断や推測は書かないでください（それはタグで表します）。</p>
${error}<textarea id="fact-content" name="content" rows="3" maxlength="${LIMITS.factContent}" required placeholder="検証可能な事実を短く入力">${esc(fields.content ?? "")}</textarea>
<input id="fact-source-url" name="source_url" type="url" maxlength="${LIMITS.sourceUrl}" required placeholder="出典 URL（必須）" aria-label="出典 URL"${url}>
<select id="fact-source-type" name="source_type" aria-label="出典の種別">${options}</select>
<button type="submit">追加</button>
${turnstileWidget(siteKey)}
</form>`;
}

/** 書く側の画面の見た目。page-css.ts の .tag-form に足す分だけ。 */
export const FORM_CSS = `
.tag-form {
  display: grid;
  gap: 10px;
  padding: 22px;
  border-top: 1px solid var(--line);
}

.form-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--red);
  border-radius: 8px;
  background: #fbf1f1;
  color: var(--red);
  font-size: 14px;
  font-weight: 700;
}

.cf-turnstile {
  min-height: 65px;
}

.fact-form {
  margin-top: 18px;
}

.fact-form select {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfa;
  color: var(--ink);
}

.form-note {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
`;

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

/** 送った後に同じページで出す 1 行と、入力欄に戻す値。 */
export interface FormNotice {
  message: string;
  value?: string;
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
`;

// R1-3 ページ表示とワードクラウド。Worker が HTML をそのまま返す（検索結果と X のカードに載せるため）。
// 構成と見た目は docs/prototype/page.jsx・globals.css を写した。視界ボタン（Q-006）は URL の値（?recent= など）で切り替える。
// 「全体との差」（Q-011）は <details> で開く追加の 1 枚。既定の表示はワードクラウドのまま。
// 雲の上にページの輪郭（D-013、outline.ts）を 1 枚、その下に票の集まり方の帯（D-014、spread.ts）を 1 本置く。
// タグを足すフォーム（Q-013）は write-forms.ts の部品を tag-list の下に置く。経路は form-routes.ts。
// タグごとの賛成・反対ボタン（Q-014）も write-forms.ts の部品で、タグのフォームを form 属性で送る。
// ファクトを足すフォーム（Q-015）も write-forms.ts の部品で、facts-list の下に置く。
// 通報（Q-021）で 3 件集まったタグ・ファクトは出さない（reports.ts の notHidden。タグは views.ts の集計で外れる）。

import type { Env } from "./index";
import {
  DEFAULT_VIEW,
  diffTagShares,
  shouldStandardizeDiff,
  listTagsByView,
  parseViewState,
  type TagShareDiff,
  type ViewDiff,
  type ViewState,
  type ViewTag,
} from "./views";
import { renderViewButtons, viewQuery } from "./view-buttons";
import { PAGE_CSS } from "./page-css";
import { renderOutline } from "./outline";
import { renderSpread } from "./spread";
import {
  FORM_CSS,
  renderFactForm,
  renderReportButton,
  renderTagForm,
  renderVoteButtons,
  REPORT_DONE_NOTE,
  voteHint,
  type FormNotice,
} from "./write-forms";
import { notHidden } from "./reports";
import { notFoundResponse, SITE_CSS, SITE_FOOTER } from "./site-pages";

interface EntityRow {
  id: string;
  title: string;
  summary: string;
}

interface FactRow {
  id: string;
  content: string;
  source_url: string;
  source_type: string | null;
  created_at: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** ワードクラウドの語の大きさ（px）。総票数（up + down）を最大値で割って 18〜56 に写す（D-012）。 */
export function wordSize(total: number, maxTotal: number): number {
  return 18 + Math.round((total / Math.max(1, maxTotal)) * 38);
}

/**
 * 偏りの確かさ（色の濃さ、0〜1）。z = |up − down| ÷ √(up + down) を 0〜3 で 0〜1 に写し、3 を超えたら 1（D-012）。
 * 10 対 10 は 0（灰色）、18 対 2 は 1、1 対 0 は 0.33。票が無ければ 0。
 */
export function certainty(up: number, down: number): number {
  const total = up + down;
  if (total === 0) return 0;
  const z = Math.abs(up - down) / Math.sqrt(total);
  return Math.round(Math.min(1, z / 3) * 100) / 100;
}

// 審査の画面が無いので、審査待ちもすぐ出す。隠すのは却下（rejected）だけ（決裁 2026-10-12）。
async function visibleFacts(env: Env, entityId: string): Promise<FactRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, source_url, source_type, created_at FROM facts
     WHERE entity_id = ? AND status != 'rejected' AND ${notHidden("fact", "facts.id")} ORDER BY created_at, id`,
  )
    .bind(entityId)
    .all<FactRow>();
  return results;
}

// 出典は http(s) だけを入れる（validate.ts と同じ）。表に古い値があっても javascript: などをリンクにしない。
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : "#");

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

/** reportButton があれば出典の横に「通報」ボタン（Q-021）を置く。 */
function renderFacts(facts: FactRow[], reportButton: ((fact: FactRow) => string) | null = null): string {
  if (facts.length === 0) return `<div class="empty-state">ファクトはまだありません。</div>`;
  return facts
    .map((f) => {
      const kind = f.source_type ? `${escapeHtml(f.source_type)} / ` : "";
      return `<article class="fact-item"><p>${escapeHtml(f.content)}</p>
<a href="${safeHref(f.source_url)}" target="_blank" rel="noreferrer nofollow">出典 / ${kind}${formatDate(f.created_at)}</a>${reportButton ? reportButton(f) : ""}</article>`;
    })
    .join("\n");
}

function renderCloud(tags: ViewTag[]): string {
  if (tags.length === 0) return `<div class="empty-state">この視界に一致するタグはまだありません。</div>`;
  const max = Math.max(1, ...tags.map((t) => t.up + t.down));
  return tags
    .map((t) => {
      const cls = t.score < 0 ? "cloud-word negative" : "cloud-word";
      return `<span class="${cls}" style="--sure: ${certainty(t.up, t.down)}; --size: ${wordSize(t.up + t.down, max)}px" title="👍${t.up} 👎${t.down} 合計${t.up + t.down}">${escapeHtml(t.tag_text)}<small>👍${t.up} 👎${t.down}</small></span>`;
    })
    .join("\n");
}

/** voteButtons があれば票数の代わりに賛成・反対ボタン（Q-014、write-forms.ts）を置く。 */
function renderTagList(tags: ViewTag[], voteButtons: ((tag: ViewTag) => string) | null = null): string {
  return tags
    .map(
      (t) => `<article class="tag-row"><div><h3>${escapeHtml(t.tag_text)}</h3>
<p>net ${t.score} / total ${t.up + t.down}</p></div>
${voteButtons ? voteButtons(t) : `<div class="vote-counts"><span>👍 ${t.up}</span><span>👎 ${t.down}</span></div>`}</article>`,
    )
    .join("\n");
}

const isDefaultView = (view: ViewState) => view.recent === 0 && view.consensus === 0 && view.controversy === 0;

/** 差の 2 段の語の大きさ（px）。差の強さを両段の最大値で割って、ワードクラウドと同じ 18〜56 に写す。 */
export function diffSize(strength: number, maxStrength: number): number {
  return maxStrength > 0 ? 18 + Math.round((Math.abs(strength) / maxStrength) * 38) : 18;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

function renderDiffRow(entries: TagShareDiff[], maxStrength: number, negative: boolean, emptyText: string): string {
  if (entries.length === 0) return `<div class="empty-state">${emptyText}</div>`;
  const cls = negative ? "cloud-word negative" : "cloud-word";
  return entries
    .map(
      (d) =>
        `<span class="${cls}" style="--size: ${diffSize(d.strength, maxStrength)}px" title="全体 ${percent(d.allShare)} → この視界 ${percent(d.viewShare)}">${escapeHtml(d.tag_text)}<em>${percent(d.allShare)} → ${percent(d.viewShare)}</em></span>`,
    )
    .join("\n");
}

/**
 * 視界と全体とで、タグの票の比率の差を上下 2 段で出す。上段＝上がったタグ、下段＝下がったタグ。
 * 変わらないタグは出さない。語の大きさは差の大きさ（両段で同じ物差し）。
 * diff が null（視界ボタンが全部未押し）なら、ボタンを押すよう 1 行だけ出す。
 * 視界に票が 1 つも無いときは、全部を「下がった」に見せないよう、比べられない旨の 1 行だけ出す（D-007）。
 * standardized（直近一週間の視界）なら、大きさが偶然の揺れで割った差であることを書き添える（D-008）。
 */
export function renderViewDiff(diff: ViewDiff | null, standardized = false): string {
  let body: string;
  if (diff === null) {
    body = `<div class="empty-state">視界ボタンを押すと、全体と比べて比率の上がったタグと下がったタグが出ます。</div>`;
  } else if (!diff.comparable) {
    body = `<div class="empty-state">この視界には票が 1 つも無いので、全体と比べられません。</div>`;
  } else {
    const max = Math.max(0, ...[...diff.up, ...diff.down].map((d) => d.strength));
    body = `<div class="diff-row diff-up" aria-label="上がったタグ"><h4>上がった</h4>
<div class="diff-words">
${renderDiffRow(diff.up, max, false, "この視界で比率の上がったタグはありません。")}
</div></div>
<div class="diff-row diff-down" aria-label="下がったタグ"><h4>下がった</h4>
<div class="diff-words">
${renderDiffRow(diff.down, max, true, "この視界で比率の下がったタグはありません。")}
</div></div>`;
  }
  return `<details class="view-diff">
<summary>全体との差を見る</summary>
<p class="diff-note">比率はタグの票数 ÷ ページの票数。全体での比率と、この視界での比率の差です。${
    standardized ? "直近一週間のボタンを押した視界では、票が少ないと比率が偶然に大きく動くので、語の大きさと並びは、その票数なら偶然に出る揺れで差を割った値です。" : ""
  }</p>
${body}
</details>`;
}

/**
 * pageUrl は canonical に使う（視界の値を付けない）。path は視界ボタンのリンク先。
 * allTags は視界ボタンが押されている時の全体のタグ（輪郭を薄く重ねる用）。未押しなら null で、tags が全体。
 */
export function renderEntityPage(
  entity: EntityRow,
  facts: FactRow[],
  tags: ViewTag[],
  pageUrl: string,
  view: ViewState = DEFAULT_VIEW,
  path = `/p/${encodeURIComponent(entity.id)}`,
  diff: ViewDiff | null = null,
  allTags: ViewTag[] | null = null,
  tagForm = "",
  voteButtons: ((tag: ViewTag) => string) | null = null,
  voteNote = "",
  factForm = "",
  factReportButton: ((fact: FactRow) => string) | null = null,
  statusNote = "",
): string {
  const title = escapeHtml(entity.title);
  const summary = escapeHtml(entity.summary);
  const url = escapeHtml(pageUrl);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | メタグモ</title>
<meta name="description" content="${summary}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="メタグモ">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${summary}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<style>${PAGE_CSS}${FORM_CSS}${SITE_CSS}</style>
</head>
<body>
<main class="app-shell">
<header class="topbar">
<a class="brand" href="/" aria-label="メタグモ ホーム"><span class="brand-mark">M</span><span>メタグモ</span></a>
</header>
<section class="entity-hero" id="top">
<div><h1>${title}</h1><p>${summary}</p></div>
<div class="hero-stats" aria-label="現在のページ統計">
<div><strong>${facts.length}</strong><span>Facts</span></div>
<div><strong>${tags.length}</strong><span>Tags</span></div>
</div>
</section>
${statusNote}<section class="content-grid">
<aside class="facts-panel">
<div class="section-title"><h2>Facts</h2><p>先に事実を置き、印象はタグで分けます。</p></div>
<div class="facts-list">
${renderFacts(facts, factReportButton)}
</div>
${factForm}
</aside>
<section class="tag-experience" aria-label="タグ視界">
<div class="toolbar"><div><h2>Word Cloud</h2><p>ボタンを押すと、同じタグ群の見え方が変わります。語の大きさは票の総数（賛成 + 反対）、色は賛成寄りか反対寄りか、色の濃さは偏りの確かさです。票が割れているタグは大きく灰色に出ます。</p></div></div>
${renderViewButtons(view, path)}
${allTags === null ? renderOutline(tags, null) : renderOutline(allTags, tags)}
${allTags === null ? renderSpread(tags, null) : renderSpread(allTags, tags)}
<div class="cloud" aria-label="タグワードクラウド">
${renderCloud(tags)}
</div>
<div class="tag-list">
${tags.length > 0 ? voteNote : ""}${renderTagList(tags, voteButtons)}
</div>
${tagForm}
${renderViewDiff(diff, shouldStandardizeDiff(view))}
</section>
</section>
${SITE_FOOTER}
</main>
</body>
</html>`;
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

const badViewPage = () =>
  html(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>視界の指定が不正です | メタグモ</title></head><body><p>視界の指定が正しくありません（0・1・2 のどれかを指定します）。</p></body></html>`,
    400,
  );

/** `/p/:id` を受ける。視界は ?recent= / ?consensus= / ?controversy= の 0・1・2。それ以外の値は 400。 */
export async function handlePage(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  return pageResponse(request, env, id);
}

/**
 * ページの HTML の応答。フォームの送信に失敗した時は、notice（理由の 1 行と入力値）と status を付けて同じページを返す。
 * 視界は request の URL の値から読む。
 */
export async function pageResponse(
  request: Request,
  env: Env,
  id: string,
  notice: FormNotice | null = null,
  status = 200,
): Promise<Response> {
  const entity = await env.DB.prepare("SELECT id, title, summary FROM entities WHERE id = ?")
    .bind(id)
    .first<EntityRow>();
  if (!entity) return notFoundResponse();
  const parsed = parseViewState(new URL(request.url).searchParams);
  if (!parsed.ok) return badViewPage();
  const now = new Date();
  const isDefault = isDefaultView(parsed.view);
  // 全体のタグは視界が未押しなら同じものなので、引き直さない。
  const [facts, tags, allTags] = await Promise.all([
    visibleFacts(env, id),
    listTagsByView(env.DB, id, parsed.view, now),
    isDefault ? Promise.resolve(null) : listTagsByView(env.DB, id, DEFAULT_VIEW, now),
  ]);
  const diff = allTags === null ? null : diffTagShares(allTags, tags, { standardize: shouldStandardizeDiff(parsed.view) });
  const path = `/p/${encodeURIComponent(id)}`;
  const pageUrl = new URL(path, request.url).toString();
  const isFact = notice?.form === "fact";
  const tagForm = renderTagForm(id, env.TURNSTILE_SITE_KEY, isFact ? null : notice);
  const factForm = renderFactForm(id, env.TURNSTILE_SITE_KEY, isFact ? notice : null);
  const query = viewQuery(parsed.view);
  const voteButtons = (tag: ViewTag) =>
    `<div class="tag-actions">${renderVoteButtons(id, tag, query)}${renderReportButton(id, "tag", tag.id, tag.tag_text)}</div>`;
  const factReportButton = (fact: FactRow) => renderReportButton(id, "fact", fact.id, fact.content.slice(0, 40));
  const reported = new URL(request.url).searchParams.get("reported") === "1" && notice === null ? REPORT_DONE_NOTE : "";
  return html(
    renderEntityPage(
      entity, facts, tags, pageUrl, parsed.view, path, diff, allTags, tagForm,
      voteButtons, voteHint(env.TURNSTILE_SITE_KEY), factForm, factReportButton, reported,
    ),
    status,
  );
}

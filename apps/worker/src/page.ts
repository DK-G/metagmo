// R1-3 ページ表示とワードクラウド。Worker が HTML をそのまま返す（検索結果と X のカードに載せるため）。
// 構成と見た目は docs/prototype/page.jsx・globals.css を写した。視界ボタン（Q-006）と投稿・投票の画面はまだ無い。

import type { Env } from "./index";
import { listTagsByView, type ViewTag } from "./views";
import { PAGE_CSS } from "./page-css";

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

/** ワードクラウドの語の大きさ（px）。|up - down| を最大値で割って 18〜56 に写す（試作と同じ式）。 */
export function wordSize(score: number, maxAbsScore: number): number {
  return 18 + Math.round((Math.abs(score) / Math.max(1, maxAbsScore)) * 38);
}

// 審査の画面が無いので、審査待ちもすぐ出す。隠すのは却下（rejected）だけ（決裁 2026-10-12）。
async function visibleFacts(env: Env, entityId: string): Promise<FactRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, content, source_url, source_type, created_at FROM facts
     WHERE entity_id = ? AND status != 'rejected' ORDER BY created_at, id`,
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

function renderFacts(facts: FactRow[]): string {
  if (facts.length === 0) return `<div class="empty-state">ファクトはまだありません。</div>`;
  return facts
    .map((f) => {
      const kind = f.source_type ? `${escapeHtml(f.source_type)} / ` : "";
      return `<article class="fact-item"><p>${escapeHtml(f.content)}</p>
<a href="${safeHref(f.source_url)}" target="_blank" rel="noreferrer nofollow">出典 / ${kind}${formatDate(f.created_at)}</a></article>`;
    })
    .join("\n");
}

function renderCloud(tags: ViewTag[]): string {
  if (tags.length === 0) return `<div class="empty-state">この視界に一致するタグはまだありません。</div>`;
  const max = Math.max(1, ...tags.map((t) => Math.abs(t.score)));
  return tags
    .map((t) => {
      const cls = t.score < 0 ? "cloud-word negative" : "cloud-word";
      return `<span class="${cls}" style="--size: ${wordSize(t.score, max)}px" title="👍${t.up} 👎${t.down} 合計${t.up + t.down}">${escapeHtml(t.tag_text)}<small>👍${t.up} 👎${t.down}</small></span>`;
    })
    .join("\n");
}

function renderTagList(tags: ViewTag[]): string {
  return tags
    .map(
      (t) => `<article class="tag-row"><div><h3>${escapeHtml(t.tag_text)}</h3>
<p>net ${t.score} / total ${t.up + t.down}</p></div>
<div class="vote-counts"><span>👍 ${t.up}</span><span>👎 ${t.down}</span></div></article>`,
    )
    .join("\n");
}

export function renderEntityPage(entity: EntityRow, facts: FactRow[], tags: ViewTag[], pageUrl: string): string {
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
<style>${PAGE_CSS}</style>
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
<section class="content-grid">
<aside class="facts-panel">
<div class="section-title"><h2>Facts</h2><p>先に事実を置き、印象はタグで分けます。</p></div>
<div class="facts-list">
${renderFacts(facts)}
</div>
</aside>
<section class="tag-experience" aria-label="タグ視界">
<div class="toolbar"><div><h2>Word Cloud</h2><p>語の大きさは賛成と反対の差（up − down）です。</p></div></div>
<div class="cloud" aria-label="タグワードクラウド">
${renderCloud(tags)}
</div>
<div class="tag-list">
${renderTagList(tags)}
</div>
</section>
</section>
</main>
</body>
</html>`;
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

const notFoundPage = () =>
  html(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>見つかりません | メタグモ</title></head><body><p>このページは見つかりません。</p></body></html>`,
    404,
  );

/** `/p/:id` を受ける。 */
export async function handlePage(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  const entity = await env.DB.prepare("SELECT id, title, summary FROM entities WHERE id = ?")
    .bind(id)
    .first<EntityRow>();
  if (!entity) return notFoundPage();
  const [facts, tags] = await Promise.all([visibleFacts(env, id), listTagsByView(env.DB, id)]);
  const pageUrl = new URL(`/p/${encodeURIComponent(id)}`, request.url).toString();
  return html(renderEntityPage(entity, facts, tags, pageUrl));
}

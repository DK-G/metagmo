// トップ `/`。新しい順のページ一覧を Worker が HTML で返す（Q-012）。
// 試作（docs/prototype/page.jsx）にトップ一覧は無いので、Q-005 のページと同じ CSS の部品（ヒーロー・パネル・ファクトのカード）で組んだ。

import type { Env } from "./index";
import { escapeHtml } from "./page";
import { PAGE_CSS } from "./page-css";
import { SITE_CSS, SITE_FOOTER } from "./site-pages";

export interface HomeEntityRow {
  id: string;
  title: string;
  summary: string;
  created_at: string;
}

/** 一覧に出す件数の上限。ページ送りは件数が増えてから入れる。 */
export const HOME_LIMIT = 50;

// 並びは GET /api/entities の sort=newest と同じ（created_at の新しい順、同時刻は id 順）。
async function newestEntities(env: Env): Promise<HomeEntityRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, title, summary, created_at FROM entities ORDER BY created_at DESC, id LIMIT ?",
  )
    .bind(HOME_LIMIT)
    .all<HomeEntityRow>();
  return results;
}

// ページの部品はそのまま使い、一覧の置き場所の余白だけ足す。
const HOME_CSS = `
.home-list {
  padding: 0 clamp(18px, 4vw, 56px) clamp(48px, 7vw, 82px);
}

.home-list .facts-panel {
  display: block;
}

.home-list .fact-item h2 {
  margin: 0 0 6px;
  font-size: 20px;
  line-height: 1.3;
}

.home-list .fact-item h2 a {
  color: var(--ink);
  font-size: inherit;
}

.home-list .fact-item p {
  font-weight: 400;
  color: var(--muted);
}
`;

function renderList(entities: HomeEntityRow[]): string {
  if (entities.length === 0) return `<div class="empty-state">ページはまだありません。</div>`;
  return entities
    .map((e) => {
      const href = `/p/${encodeURIComponent(e.id)}`;
      return `<article class="fact-item"><h2><a href="${escapeHtml(href)}">${escapeHtml(e.title)}</a></h2>
<p>${escapeHtml(e.summary)}</p></article>`;
    })
    .join("\n");
}

export function renderHomePage(entities: HomeEntityRow[], pageUrl: string): string {
  const url = escapeHtml(pageUrl);
  const description = "事実と印象を分けて、タグの賛否で見え方を比べるページの一覧。";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>メタグモ</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="メタグモ">
<meta property="og:title" content="メタグモ">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<style>${PAGE_CSS}${SITE_CSS}${HOME_CSS}</style>
</head>
<body>
<main class="app-shell">
<header class="topbar">
<a class="brand" href="/" aria-label="メタグモ ホーム"><span class="brand-mark">M</span><span>メタグモ</span></a>
</header>
<section class="entity-hero" id="top">
<div><h1>メタグモ</h1><p>${description}</p></div>
<div class="hero-stats" aria-label="ページ数">
<div><strong>${entities.length}</strong><span>Pages</span></div>
</div>
</section>
<section class="home-list">
<div class="facts-panel">
<div class="section-title"><h2>新しいページ</h2><p>新しく作られた順に並べています。</p></div>
<div class="facts-list">
${renderList(entities)}
</div>
</div>
</section>
${SITE_FOOTER}
</main>
</body>
</html>`;
}

/** `/` を受ける。 */
export async function handleHome(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  const entities = await newestEntities(env);
  const pageUrl = new URL("/", request.url).toString();
  return new Response(renderHomePage(entities, pageUrl), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

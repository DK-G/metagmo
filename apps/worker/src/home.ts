// トップ `/`。ページ一覧を Worker が HTML で返す（Q-012）。
// 試作（docs/prototype/page.jsx）にトップ一覧は無いので、Q-005 のページと同じ CSS の部品（ヒーロー・パネル・ファクトのカード）で組んだ。
// 検索の入力欄と並びの切り替え（Q-017）は試作のタグ一覧の toolbar を写した。JS なしの GET フォーム（?q=・?sort=）。
// 絞り込みと並びは GET /api/entities と同じ関数（search.ts の searchEntities）を使う。

import type { Env } from "./index";
import { escapeHtml } from "./page";
import { PAGE_CSS } from "./page-css";
import { parseSearch, searchEntities, type SearchOptions } from "./search";
import { InputError } from "./validate";
import { SITE_CSS, SITE_FOOTER } from "./site-pages";

export interface HomeEntityRow {
  id: string;
  title: string;
  summary: string;
  created_at: string;
}

/** 一覧に出す件数の上限。ページ送りは件数が増えてから入れる。 */
export const HOME_LIMIT = 50;

/** トップの既定。何も指定しなければ新しい順の全件。 */
const DEFAULT_SEARCH: SearchOptions = { q: "", sort: "newest" };

const SORT_LABELS: Record<SearchOptions["sort"], string> = {
  newest: "新しい順",
  score_desc: "スコア順",
};

// ページの部品はそのまま使い、一覧の置き場所の余白と検索欄の並びだけ足す。
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

.home-search {
  margin: 0 0 18px;
}

.home-search .toolbar-controls {
  grid-template-columns: minmax(160px, 1fr) 132px auto;
  min-width: 0;
}

.home-search button {
  min-height: 42px;
  padding: 0 18px;
  border-radius: 8px;
  background: var(--ink);
  color: white;
  font-weight: 900;
}

.home-search label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .home-search .toolbar-controls {
    grid-template-columns: 1fr;
  }
}
`;

function renderSearchForm({ q, sort }: SearchOptions): string {
  const options = (Object.keys(SORT_LABELS) as SearchOptions["sort"][])
    .map((value) => `<option value="${value}"${value === sort ? " selected" : ""}>${SORT_LABELS[value]}</option>`)
    .join("");
  return `<form class="home-search" method="get" action="/" role="search">
<div class="toolbar-controls">
<label for="home-q">ページを探す</label>
<input id="home-q" name="q" type="search" value="${escapeHtml(q)}" placeholder="タイトルかタグで探す">
<label for="home-sort">並び</label>
<select id="home-sort" name="sort">${options}</select>
<button type="submit">探す</button>
</div>
</form>`;
}

function renderList(entities: HomeEntityRow[], { q }: SearchOptions): string {
  if (entities.length === 0) {
    const message = q === "" ? "ページはまだありません。" : `「${escapeHtml(q)}」に当たるページはありません。`;
    return `<div class="empty-state">${message}<br><a href="/new">新しいページを作る</a></div>`;
  }
  return entities
    .map((e) => {
      const href = `/p/${encodeURIComponent(e.id)}`;
      return `<article class="fact-item"><h2><a href="${escapeHtml(href)}">${escapeHtml(e.title)}</a></h2>
<p>${escapeHtml(e.summary)}</p></article>`;
    })
    .join("\n");
}

function listHeading({ q, sort }: SearchOptions): { title: string; note: string } {
  if (q !== "") {
    return { title: `「${escapeHtml(q)}」の検索結果`, note: `タイトルかタグに含むページを${SORT_LABELS[sort]}に並べています。` };
  }
  if (sort === "score_desc") return { title: "スコアの高いページ", note: "タグの票（賛成 − 反対）の合計が多い順に並べています。" };
  return { title: "新しいページ", note: "新しく作られた順に並べています。" };
}

/**
 * トップの HTML。canonical は検索・並びの値によらず常に値なしの `/`（pageUrl に渡す）。
 * search を省くと既定（全件・新しい順）として描く。
 */
export function renderHomePage(entities: HomeEntityRow[], pageUrl: string, search: SearchOptions = DEFAULT_SEARCH): string {
  const url = escapeHtml(pageUrl);
  const description = "事実と印象を分けて、タグの賛否で見え方を比べるページの一覧。";
  const heading = listHeading(search);
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
${renderSearchForm(search)}
<div class="facts-panel">
<div class="section-title"><h2>${heading.title}</h2><p>${heading.note}</p></div>
<div class="facts-list">
${renderList(entities, search)}
</div>
</div>
</section>
${SITE_FOOTER}
</main>
</body>
</html>`;
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

const badSearchPage = (field: string) => {
  const message =
    field === "sort"
      ? "並びの指定が正しくありません（newest か score_desc のどちらかを指定します）。"
      : "検索の語が長すぎます。";
  return html(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>検索の指定が不正です | メタグモ</title></head><body><p>${message}</p><p><a href="/">トップへ戻る</a></p></body></html>`,
    400,
  );
};

/** `/` を受ける。?q= はタイトルかタグの部分一致、?sort= は newest（既定）か score_desc。それ以外の sort は 400。 */
export async function handleHome(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });
  }
  let search: SearchOptions;
  try {
    search = parseSearch(new URL(request.url).searchParams, DEFAULT_SEARCH.sort);
  } catch (e) {
    if (e instanceof InputError) return badSearchPage(e.field);
    throw e;
  }
  const entities = await searchEntities(env.DB, search, HOME_LIMIT);
  const pageUrl = new URL("/", request.url).toString();
  return html(renderHomePage(entities, pageUrl, search));
}

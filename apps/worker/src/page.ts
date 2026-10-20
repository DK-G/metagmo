// R1-3 ページ表示とワードクラウド。Worker が HTML をそのまま返す（検索結果と X のカードに載せるため）。
// 構成と見た目は docs/prototype/page.jsx・globals.css を写した。視界ボタン（Q-006）は URL の値（?recent= など）で切り替える。
// 「全体との差」（Q-011）は <details> で開く追加の 1 枚。既定の表示はワードクラウドのまま。
// 投稿・投票の画面はまだ無い。

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
import { renderViewButtons } from "./view-buttons";
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

/** pageUrl は canonical に使う（視界の値を付けない）。path は視界ボタンのリンク先。 */
export function renderEntityPage(
  entity: EntityRow,
  facts: FactRow[],
  tags: ViewTag[],
  pageUrl: string,
  view: ViewState = DEFAULT_VIEW,
  path = `/p/${encodeURIComponent(entity.id)}`,
  diff: ViewDiff | null = null,
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
<div class="toolbar"><div><h2>Word Cloud</h2><p>ボタンを押すと、同じタグ群の見え方が変わります。語の大きさは賛成と反対の差（up − down）です。</p></div></div>
${renderViewButtons(view, path)}
<div class="cloud" aria-label="タグワードクラウド">
${renderCloud(tags)}
</div>
<div class="tag-list">
${renderTagList(tags)}
</div>
${renderViewDiff(diff, shouldStandardizeDiff(view))}
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
  const entity = await env.DB.prepare("SELECT id, title, summary FROM entities WHERE id = ?")
    .bind(id)
    .first<EntityRow>();
  if (!entity) return notFoundPage();
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
  return html(renderEntityPage(entity, facts, tags, pageUrl, parsed.view, path, diff));
}

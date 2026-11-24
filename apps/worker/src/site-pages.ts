// 公開に要る脇のページ（Q-018）: 見出しつきの 404、/robots.txt、/sitemap.xml、/about、全ページ共通のフッター。
// 見た目は page-css.ts の部品（トップバー・ヒーロー・パネル）をそのまま使い、足すのはフッターと本文の余白だけ。

import type { Env } from "./index";
import { escapeHtml } from "./page";
import { PAGE_CSS } from "./page-css";

/** sitemap 1 枚に入れられる URL の上限（sitemaps.org の規約）。 */
export const SITEMAP_LIMIT = 50000;

/** 脇のページとフッターの CSS。`page.ts`・`home.ts` は `<style>` にこれを足す。 */
export const SITE_CSS = `
.site-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 22px clamp(18px, 4vw, 56px) 32px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 14px;
}

.new-page-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--ink);
  color: white;
  font-size: 14px;
  font-weight: 900;
  text-decoration: none;
}

.site-footer a {
  color: var(--muted);
}

.prose-panel {
  padding: 0 clamp(18px, 4vw, 56px) clamp(32px, 5vw, 56px);
}

.prose-panel .facts-panel {
  display: block;
  max-width: 760px;
}

.prose-panel h2 {
  margin: 22px 0 8px;
  font-size: 20px;
  line-height: 1.35;
}

.prose-panel h2:first-child {
  margin-top: 0;
}

.prose-panel p,
.prose-panel li {
  line-height: 1.75;
  overflow-wrap: anywhere;
}
`;

/** トップバーの右に置く「ページを作る」へのリンク（Q-016）。トップ・`/p/:id`・脇のページで共通。 */
export const NEW_PAGE_LINK = `<a class="new-page-link" href="/new">＋ ページを作る</a>`;

/** 全ページの末尾に置くフッター。 */
export const SITE_FOOTER = `<footer class="site-footer"><a href="/">トップ</a><a href="/about">メタグモについて</a></footer>`;

const TOPBAR = `<header class="topbar">
<a class="brand" href="/" aria-label="メタグモ ホーム"><span class="brand-mark">M</span><span>メタグモ</span></a>
${NEW_PAGE_LINK}
</header>`;

function shell(opts: { title: string; heading: string; lead: string; body: string; canonical?: string; noindex?: boolean }): string {
  const head = [
    `<title>${escapeHtml(opts.title)}</title>`,
    `<meta name="description" content="${escapeHtml(opts.lead)}">`,
    opts.canonical ? `<link rel="canonical" href="${escapeHtml(opts.canonical)}">` : "",
    opts.noindex ? `<meta name="robots" content="noindex">` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<style>${PAGE_CSS}${SITE_CSS}</style>
</head>
<body>
<main class="app-shell">
${TOPBAR}
<section class="entity-hero" id="top">
<div><h1>${escapeHtml(opts.heading)}</h1><p>${escapeHtml(opts.lead)}</p></div>
</section>
<section class="prose-panel">
<div class="facts-panel">
${opts.body}
</div>
</section>
${SITE_FOOTER}
</main>
</body>
</html>`;
}

const htmlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

/** 見出しつきの 404 の HTML。どの経路にも当たらない URL と、存在しない `/p/:id` に返す。 */
export function notFoundResponse(): Response {
  return htmlResponse(
    shell({
      title: "ページが見つかりません | メタグモ",
      heading: "ページが見つかりません",
      lead: "URL が間違っているか、ページが無くなっています。",
      body: `<p>トップの一覧から探せます。</p>
<p><a href="/">トップへ戻る</a></p>`,
      noindex: true,
    }),
    404,
  );
}

const methodNotAllowed = () => new Response("method not allowed", { status: 405, headers: { Allow: "GET" } });

/** `/robots.txt`。全体をクロールしてよく、API だけ外す。sitemap の場所を書く。 */
export function handleRobots(request: Request): Response {
  if (request.method !== "GET") return methodNotAllowed();
  const sitemap = new URL("/sitemap.xml", request.url).toString();
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${sitemap}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

const xmlEscape = (s: string) => escapeHtml(s).replace(/&#39;/g, "&apos;");

/** `/sitemap.xml`。トップ・/about と、全ページの `/p/:id`（新しい順、全体で上限 5 万件）。 */
export async function handleSitemap(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed();
  const fixed = ["/", "/about"];
  const { results } = await env.DB.prepare(
    "SELECT id, created_at FROM entities ORDER BY created_at DESC, id LIMIT ?",
  )
    .bind(SITEMAP_LIMIT - fixed.length)
    .all<{ id: string; created_at: string }>();
  const loc = (path: string) => xmlEscape(new URL(path, request.url).toString());
  const urls = [
    ...fixed.map((p) => `<url><loc>${loc(p)}</loc></url>`),
    ...results.map((r) => {
      const day = /^\d{4}-\d{2}-\d{2}/.exec(r.created_at)?.[0];
      const lastmod = day ? `<lastmod>${day}</lastmod>` : "";
      return `<url><loc>${loc(`/p/${encodeURIComponent(r.id)}`)}</loc>${lastmod}</url>`;
    }),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

const ABOUT_BODY = `<h2>メタグモとは</h2>
<p>ひとつの話題について、確かめられる事実と、人それぞれの印象を分けて置くページです。印象はタグへの賛成・反対の票として集まり、その集まり方を雲や帯の形で見られます。</p>

<h2>ファクトとタグの違い</h2>
<p><strong>ファクト</strong>は、出典のリンクで確かめられる事実です。出典が無いものはファクトとして入りません。良い・悪いといった価値判断は書きません。</p>
<p><strong>タグ</strong>は、その話題への印象です。誰でもタグを足せて、誰でも賛成か反対の票を入れられます。</p>

<h2>視界の読み方</h2>
<p>ページの「視界」のボタンを押すと、同じタグが別の条件で数え直されます。</p>
<ul>
<li><strong>直近一週間</strong>: 7 日以内の票だけ、または 7 日より前の票だけで数えます。</li>
<li><strong>合意</strong>: 賛成が 7 割以上のタグだけ、または反対が 7 割以上のタグだけを残します。</li>
<li><strong>論争</strong>: 賛成が 3〜7 割で割れているタグだけ、またはそうでない（決着がついた）タグだけを残します。</li>
<li><strong>BOT の票</strong>: 運営が置いた BOT の票を除いて、人の票だけで数えます。</li>
</ul>
<p>合意と論争は、票が 3 票以上あるタグだけを数えます。</p>
<p>メタグモには、話題が空のうちの呼び水として、運営が置いた BOT が票を入れることがあります。BOT の票は隠さずに数え、「BOT の票」のボタンでいつでも除けます。</p>
<p>雲の語の大きさは票の総数、色は賛成寄りか反対寄りか、色の濃さは偏りの確かさです。視界を押すと、全体の形が薄い枠で重なり、全体との差が見られます。</p>

<h2>接続元の記録について</h2>
<p>投票の重複と、短い時間に大量の書き込みが来るのを防ぐため、書き込みのたびに接続元の IP アドレスを使います。保存するのは、秘密の鍵を使って IP アドレスから作った置き換えの値（鍵つきのハッシュ）だけで、IP アドレスそのものは保存しません。置き換えの値から元の IP アドレスを読み戻すことはできず、同じ接続元かどうかを見分けるためだけに使います。</p>
<p>あわせて、機械による書き込みを防ぐために Cloudflare Turnstile の確認を使います。</p>`;

/** `/about`。メタグモとは何か、ファクトとタグの違い、視界の読み方、接続元の記録（D-010）。 */
export function handleAbout(request: Request): Response {
  if (request.method !== "GET") return methodNotAllowed();
  return htmlResponse(
    shell({
      title: "メタグモについて | メタグモ",
      heading: "メタグモについて",
      lead: "事実と印象を分けて、タグの賛否で見え方を比べる仕組みの説明。",
      body: ABOUT_BODY,
      canonical: new URL("/about", request.url).toString(),
    }),
  );
}

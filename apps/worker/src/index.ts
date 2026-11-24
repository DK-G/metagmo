import { handleApi } from "./api";
import { handleHome } from "./home";
import { handleFactForm, handleTagForm, handleVoteForm } from "./form-routes";
import { handleNewPage } from "./new-page";
import { handlePage } from "./page";
import { handleAbout, handleRobots, handleSitemap, notFoundResponse } from "./site-pages";

export interface Env {
  DB: D1Database;
  /** Turnstile の秘密鍵（`wrangler secret put TURNSTILE_SECRET_KEY`）。無いと書き込みは 503。 */
  TURNSTILE_SECRET_KEY?: string;
  /** 接続元 IP を HMAC する秘密鍵（`wrangler secret put IP_HASH_KEY`。Turnstile とは別の値）。無いと書き込みは 503。 */
  IP_HASH_KEY?: string;
  /** Turnstile のサイトキー（秘密でない。`wrangler.jsonc` の vars）。無いとフォームにウィジェットを置かない。 */
  TURNSTILE_SITE_KEY?: string;
}

const safeDecode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      return Response.json({ ok: row?.ok === 1 });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url.pathname.slice("/api".length));
    }

    if (url.pathname === "/") {
      return handleHome(request, env);
    }
    if (url.pathname === "/robots.txt") return handleRobots(request);
    if (url.pathname === "/sitemap.xml") return handleSitemap(request, env);
    if (url.pathname === "/about") return handleAbout(request);
    if (url.pathname === "/new") return handleNewPage(request, env);

    const page = /^\/p\/([^/]+)\/?$/.exec(url.pathname);
    if (page) {
      let id: string;
      try {
        id = decodeURIComponent(page[1]);
      } catch {
        return notFoundResponse();
      }
      return handlePage(request, env, id);
    }

    const tagForm = /^\/p\/([^/]+)\/tags\/?$/.exec(url.pathname);
    if (tagForm) {
      const id = safeDecode(tagForm[1]);
      return id === null ? notFoundResponse() : handleTagForm(request, env, id);
    }

    const voteForm = /^\/p\/([^/]+)\/tags\/([^/]+)\/vote\/?$/.exec(url.pathname);
    if (voteForm) {
      const id = safeDecode(voteForm[1]);
      const tagId = safeDecode(voteForm[2]);
      return id === null || tagId === null ? notFoundResponse() : handleVoteForm(request, env, id, tagId);
    }

    const factForm = /^\/p\/([^/]+)\/facts\/?$/.exec(url.pathname);
    if (factForm) {
      const id = safeDecode(factForm[1]);
      return id === null ? notFoundResponse() : handleFactForm(request, env, id);
    }

    return notFoundResponse();
  },
} satisfies ExportedHandler<Env>;

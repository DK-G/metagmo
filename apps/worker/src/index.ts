import { handleApi } from "./api";
import { handleHome } from "./home";
import { handlePage } from "./page";

export interface Env {
  DB: D1Database;
  /** Turnstile の秘密鍵（`wrangler secret put TURNSTILE_SECRET_KEY`）。無いと書き込みは 503。 */
  TURNSTILE_SECRET_KEY?: string;
}

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

    const page = /^\/p\/([^/]+)\/?$/.exec(url.pathname);
    if (page) {
      let id: string;
      try {
        id = decodeURIComponent(page[1]);
      } catch {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      return handlePage(request, env, id);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

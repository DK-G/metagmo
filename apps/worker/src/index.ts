import { handleApi } from "./api";
import { handlePage } from "./page";

export interface Env {
  DB: D1Database;
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

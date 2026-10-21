// 匿名の書き込み（投稿・投票）の荒らし対策（Q-007）。
// 1) 接続元 IP ごとの流量制限（D1 の固定窓カウンタ。migrations/0003）
// 2) Cloudflare Turnstile の検証（トークンは X-Turnstile-Token ヘッダーで受ける）
// 流量を先に数えるので、検証に落ちた試行も上限に数える（siteverify を連打させない）。

import type { Env } from "./index";

export type WriteKind = "post" | "vote";

/** 窓 1 つあたりの上限。窓の長さは RATE_WINDOW_MS。 */
export const RATE_LIMITS: Record<WriteKind, number> = {
  post: 20, // ページ・ファクト・タグの作成をあわせて
  vote: 60,
};
export const RATE_WINDOW_MS = 10 * 60 * 1000;

export const TURNSTILE_HEADER = "X-Turnstile-Token";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const UNKNOWN_IP = "unknown";

/** 窓の始まり（UTC の ISO 文字列）。 */
export function windowStart(now: Date): string {
  return new Date(Math.floor(now.getTime() / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
}

/** この試行を数え、上限を超えていれば次の窓までの秒数を返す。超えていなければ null。 */
export async function countAttempt(db: D1Database, ip: string, kind: WriteKind, now: Date): Promise<number | null> {
  const start = windowStart(now);
  const [, upsert] = await db.batch<{ count: number }>([
    // 過ぎた窓の行は、同じ IP と種類の次の試行で消す。
    db.prepare("DELETE FROM rate_limits WHERE ip = ? AND action = ? AND window_start < ?").bind(ip, kind, start),
    db
      .prepare(
        `INSERT INTO rate_limits (ip, action, window_start, count) VALUES (?, ?, ?, 1)
         ON CONFLICT (ip, action, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(ip, kind, start),
  ]);
  const count = upsert.results[0]?.count ?? 1;
  if (count <= RATE_LIMITS[kind]) return null;
  const end = Date.parse(start) + RATE_WINDOW_MS;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

/** siteverify に問い合わせる。通信に失敗したら通さない。 */
export async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    if (!res.ok) return false;
    const outcome = (await res.json()) as { success?: unknown };
    return outcome.success === true;
  } catch {
    return false;
  }
}

/** 書き込みを通してよければ null、拒否するならその応答を返す。 */
export async function guardWrite(request: Request, env: Env, kind: WriteKind): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP");

  const retryAfter = await countAttempt(env.DB, ip ?? UNKNOWN_IP, kind, new Date());
  if (retryAfter !== null) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  // 鍵が無い時は書き込みを止める（設定漏れのまま公開しても荒らしに開かないように）。
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return Response.json({ error: "turnstile_not_configured" }, { status: 503 });

  const token = request.headers.get(TURNSTILE_HEADER)?.trim() ?? "";
  if (token === "" || !(await verifyTurnstile(secret, token, ip))) {
    return Response.json({ error: "turnstile_failed" }, { status: 403 });
  }
  return null;
}

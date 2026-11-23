// タグとファクトへの通報（Q-021・D-016）。表は migrations/0005_reports.sql。
// 戻していない通報が HIDE_THRESHOLD 件集まった対象は、/p/:id・視界の集計・検索から隠す（行は消さない）。
// 隠すかどうかは通報の行から毎回数える（印の列を持たない）。戻すのは通報の cleared_at を埋めるだけで済む。

import type { Env } from "./index";
import { hashIp } from "./guard";

export type ReportTarget = "tag" | "fact";

/** この件数の通報で隠す。 */
export const HIDE_THRESHOLD = 3;

/**
 * SQL の WHERE に足す条件。column はタグかファクトの id の列（`t.id` など）。値はコードの定数だけを埋める。
 * 例: `WHERE t.entity_id = ? AND ${notHidden("tag", "t.id")}`
 */
export function notHidden(type: ReportTarget, column: string): string {
  return `(SELECT COUNT(*) FROM reports r WHERE r.target_type = '${type}' AND r.target_id = ${column} AND r.cleared_at IS NULL) < ${HIDE_THRESHOLD}`;
}

/** フォームの値 `tag:<id>`・`fact:<id>` を読む。形が違えば null。 */
export function parseReportTarget(raw: string | undefined): { type: ReportTarget; id: string } | null {
  const m = /^(tag|fact):(.+)$/.exec(raw ?? "");
  return m ? { type: m[1] as ReportTarget, id: m[2] } : null;
}

/** 対象がこのページのものか。別ページ・無い id は false。 */
export async function targetOnPage(env: Env, entityId: string, type: ReportTarget, id: string): Promise<boolean> {
  const table = type === "tag" ? "tags" : "facts";
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM ${table} WHERE id = ? AND entity_id = ?`).bind(id, entityId).first();
  return row !== null;
}

/**
 * 通報を 1 件入れる。同じ接続元の同じ対象への 2 回目以降は数えない（表の UNIQUE で無視）。
 * checkWrite を通った後に呼ぶ（IP_HASH_KEY があることはそこで確かめ済み）。IP のヘッダーが無ければ "unknown" を 1 人に数える。
 */
export async function insertReport(request: Request, env: Env, type: ReportTarget, id: string): Promise<void> {
  if (!env.IP_HASH_KEY) throw new Error("IP_HASH_KEY is not configured");
  const reporter = await hashIp(env.IP_HASH_KEY, request.headers.get("CF-Connecting-IP") ?? "unknown");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO reports (id, target_type, target_id, reporter_hash) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), type, id, reporter)
    .run();
}

// 視界 3 ボタン（直近一週間・合意・論争）の集計。条件は metagmo_spec.md 2.1 の表どおり。
// 各ボタンは 0 = 未押し / 1 = 1 回目 / 2 = 2 回目。押されたボタンどうしは「かつ」で重ねる。

export type ViewMode = 0 | 1 | 2;

export interface ViewState {
  recent: ViewMode;
  consensus: ViewMode;
  controversy: ViewMode;
}

export const DEFAULT_VIEW: ViewState = { recent: 0, consensus: 0, controversy: 0 };

/** 合意・論争の判定に要る最少の票数（up + down）。 */
export const MIN_VOTES = 3;
/** 「直近一週間」の幅。 */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const VIEW_KEYS = ["recent", "consensus", "controversy"] as const;

export type ParsedView = { ok: true; view: ViewState } | { ok: false; field: (typeof VIEW_KEYS)[number] };

/** `?recent=1&consensus=2` の形を読む。無い項目は未押し。0・1・2 以外は不正。 */
export function parseViewState(params: URLSearchParams): ParsedView {
  const view: ViewState = { ...DEFAULT_VIEW };
  for (const key of VIEW_KEYS) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (raw !== "0" && raw !== "1" && raw !== "2") return { ok: false, field: key };
    view[key] = Number(raw) as ViewMode;
  }
  return { ok: true, view };
}

/**
 * 合意・論争の条件に合うか。up / down は「直近一週間」で絞った後の票数を渡す。
 * 比は整数で比べる（up/(up+down) ≥ 0.7 は 10*up ≥ 7*(up+down)）。小数の誤差で境界がずれないように。
 */
export function matchesView(up: number, down: number, view: Pick<ViewState, "consensus" | "controversy">): boolean {
  const total = up + down;
  const enough = total >= MIN_VOTES;
  const upAtLeast70 = 10 * up >= 7 * total;
  const upAtMost30 = 10 * up <= 3 * total; // down/(up+down) ≥ 0.7 と同じ
  const upAtLeast30 = 10 * up >= 3 * total;
  const upAtMost70 = 10 * up <= 7 * total;

  if (view.consensus === 1 && !(enough && upAtLeast70)) return false;
  if (view.consensus === 2 && !(enough && upAtMost30)) return false;
  if (view.controversy === 1 && !(enough && upAtLeast30 && upAtMost70)) return false;
  // 決着済み: 仕様の「< 0.3 または > 0.7 かつ 3 票以上」は、3 票以上を両方に掛けて読む。
  if (view.controversy === 2 && !(enough && (!upAtLeast30 || !upAtMost70))) return false;
  return true;
}

export interface ViewTag {
  id: string;
  entity_id: string;
  tag_text: string;
  created_at: string;
  up: number;
  down: number;
  score: number;
}

type TagRow = Omit<ViewTag, "score">;

/**
 * ページのタグを、視界に合わせて集計して返す。
 * 並びはネットスコア（up - down）の大きい順、同点は新しい順。
 * 「直近一週間」は数える票を絞るだけで、その期間に票の無いタグも 0 票として残る。
 */
export async function listTagsByView(
  db: D1Database,
  entityId: string,
  view: ViewState = DEFAULT_VIEW,
  now: Date = new Date(),
): Promise<ViewTag[]> {
  // votes.created_at は ISO 8601（UTC・ミリ秒 3 桁）なので、文字列のまま比べられる。
  const cutoff = new Date(now.getTime() - RECENT_WINDOW_MS).toISOString();
  const window =
    view.recent === 1 ? "AND v.created_at >= ?1" : view.recent === 2 ? "AND v.created_at < ?1" : "AND ?1 IS NOT NULL";

  const { results } = await db
    .prepare(
      `SELECT t.id, t.entity_id, t.tag_text, t.created_at,
              COALESCE(SUM(v.vote_type = 'up'), 0) AS up,
              COALESCE(SUM(v.vote_type = 'down'), 0) AS down
       FROM tags t LEFT JOIN votes v ON v.tag_id = t.id ${window}
       WHERE t.entity_id = ?2
       GROUP BY t.id
       ORDER BY (up - down) DESC, t.created_at DESC, t.id`,
    )
    .bind(cutoff, entityId)
    .all<TagRow>();

  return results.filter((row) => matchesView(row.up, row.down, view)).map((row) => ({ ...row, score: row.up - row.down }));
}

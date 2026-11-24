// 視界ボタン（直近一週間・合意・論争・BOT の票）の集計。最初の 3 つの条件は metagmo_spec.md 2.1 の表どおり。
// 各ボタンは 0 = 未押し / 1 = 1 回目 / 2 = 2 回目（BOT の票は 0 / 1 だけ）。押されたボタンどうしは「かつ」で重ねる。

import type { SearchOptions } from "./search";
import { notHidden } from "./reports";

export type ViewMode = 0 | 1 | 2;

export interface ViewState {
  recent: ViewMode;
  consensus: ViewMode;
  controversy: ViewMode;
  /** 1 なら透明 BOT の票（votes.is_bot = 1）を数えない（D-015）。2 回目は無い。 */
  nobot: 0 | 1;
}

export const DEFAULT_VIEW: ViewState = { recent: 0, consensus: 0, controversy: 0, nobot: 0 };

/** 全部未押し（＝全体の見え方）か。 */
export const isDefaultView = (view: ViewState) =>
  view.recent === 0 && view.consensus === 0 && view.controversy === 0 && view.nobot === 0;

/** 合意・論争の判定に要る最少の票数（up + down）。 */
export const MIN_VOTES = 3;
/** 「直近一週間」の幅。 */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const VIEW_KEYS = ["recent", "consensus", "controversy", "nobot"] as const;
/** 項目ごとに受ける値。nobot は 0・1 だけ。 */
const ALLOWED: Record<(typeof VIEW_KEYS)[number], readonly string[]> = {
  recent: ["0", "1", "2"],
  consensus: ["0", "1", "2"],
  controversy: ["0", "1", "2"],
  nobot: ["0", "1"],
};

export type ParsedView = { ok: true; view: ViewState } | { ok: false; field: (typeof VIEW_KEYS)[number] };

/** `?recent=1&consensus=2&nobot=1` の形を読む。無い項目は未押し。0・1・2（nobot は 0・1）以外は不正。 */
export function parseViewState(params: URLSearchParams): ParsedView {
  const view: ViewState = { ...DEFAULT_VIEW };
  for (const key of VIEW_KEYS) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (!ALLOWED[key].includes(raw)) return { ok: false, field: key };
    if (key === "nobot") view.nobot = Number(raw) as 0 | 1;
    else view[key] = Number(raw) as ViewMode;
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
 * 既定はネットスコア（up - down）の大きい順、同点は新しい順。newest は作成時刻順。
 * 「直近一週間」（1 回目・2 回目）は数える票を絞り、その期間に票の無いタグは返さない。
 * 未押しでは票の無いタグも返す。
 * 「BOT の票」を押すと（nobot = 1）、BOT の印の付いた票を数えない。他の視界と同じく票を絞るだけで、タグは消さない。
 */
export async function listTagsByView(
  db: D1Database,
  entityId: string,
  view: ViewState = DEFAULT_VIEW,
  now: Date = new Date(),
  search: SearchOptions = { q: "", sort: "score_desc" },
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
       FROM tags t LEFT JOIN votes v ON v.tag_id = t.id ${window}${view.nobot === 1 ? " AND v.is_bot = 0" : ""}
       WHERE t.entity_id = ?2 AND instr(lower(t.tag_text), lower(?3)) > 0 AND ${notHidden("tag", "t.id")}
       GROUP BY t.id
       ORDER BY ${search.sort === "score_desc" ? "(up - down) DESC," : ""} t.created_at DESC, t.id`,
    )
    .bind(cutoff, entityId, search.q)
    .all<TagRow>();

  return results
    .filter((row) => view.recent === 0 || row.up + row.down > 0)
    .filter((row) => matchesView(row.up, row.down, view))
    .map((row) => ({ ...row, score: row.up - row.down }));
}

export interface TagShareDiff {
  id: string;
  tag_text: string;
  /** 全体での比率（そのタグの票数 ÷ ページの全タグの票数）。 */
  allShare: number;
  /** 視界での比率（視界に残ったタグの票数で同じく割る）。視界から外れたタグは 0。 */
  viewShare: number;
  /** viewShare - allShare。正なら視界で上がった、負なら下がった。 */
  diff: number;
  /**
   * 差の強さ（0 以上）。並び順と表示の大きさに使う。既定は |diff|。
   * standardize のときは |diff| ÷ √(allShare × (1 − allShare) ÷ 視界の票数)＝票数なら偶然に出る揺れで割った差（D-008）。
   */
  strength: number;
}

export interface ViewDiff {
  /** 全体と視界の両方に票があり、比べられるか。false なら up・down は空（D-007）。 */
  comparable: boolean;
  /** 視界で比率が上がったタグ。差の大きい順。 */
  up: TagShareDiff[];
  /** 視界で比率が下がったタグ。差の大きい順（diff の小さい順）。 */
  down: TagShareDiff[];
  /** 比率が変わらないタグ。表示では出さない。 */
  same: TagShareDiff[];
}

/**
 * 全体と視界とで、タグごとの「票の比率」の差を求めて上がった・下がった・変わらないに分ける。
 * 比率はタグの票数（up + down）をそのページの票数の合計で割ったもの。
 * どちらかの合計が 0 なら比べられないので、すべて same に入れる。
 * 上がった・下がったの判定は整数の掛け算で行う（小数の誤差で同じ比率が差ありにならないように）。
 */
export function diffTagShares(
  all: ViewTag[],
  inView: ViewTag[],
  options: { standardize?: boolean } = {},
): ViewDiff {
  const votesOf = (t: ViewTag) => t.up + t.down;
  const allTotal = all.reduce((sum, t) => sum + votesOf(t), 0);
  const viewById = new Map(inView.map((t) => [t.id, t]));
  const viewTotal = inView.reduce((sum, t) => sum + votesOf(t), 0);
  const comparable = allTotal > 0 && viewTotal > 0;

  // 上がった・下がったに入るタグは 0 < allShare < 1 なので、揺れの分母は 0 にならない。
  const strengthOf = (diff: number, allShare: number) =>
    options.standardize ? Math.abs(diff) / Math.sqrt((allShare * (1 - allShare)) / viewTotal) : Math.abs(diff);

  const result: ViewDiff = { comparable, up: [], down: [], same: [] };
  for (const tag of all) {
    const allVotes = votesOf(tag);
    const viewTag = viewById.get(tag.id);
    const viewVotes = viewTag ? votesOf(viewTag) : 0;
    const allShare = allTotal > 0 ? allVotes / allTotal : 0;
    const viewShare = viewTotal > 0 ? viewVotes / viewTotal : 0;
    const diff = viewShare - allShare;
    const entry: TagShareDiff = { id: tag.id, tag_text: tag.tag_text, allShare, viewShare, diff, strength: 0 };
    if (!comparable) {
      result.same.push({ ...entry, viewShare: allShare, diff: 0 });
      continue;
    }
    const lhs = viewVotes * allTotal;
    const rhs = allVotes * viewTotal;
    if (lhs > rhs) result.up.push({ ...entry, strength: strengthOf(diff, allShare) });
    else if (lhs < rhs) result.down.push({ ...entry, strength: strengthOf(diff, allShare) });
    else result.same.push({ ...entry, diff: 0 });
  }
  result.up.sort((a, b) => b.strength - a.strength);
  result.down.sort((a, b) => b.strength - a.strength);
  return result;
}

/** 直近一週間の視界は票が少ないので、差を偶然の揺れで割って比べる（D-008）。合意・論争はタグの絞り込みなので生の差のまま。 */
export const shouldStandardizeDiff = (view: ViewState) => view.recent !== 0;

/** ページのタグについて、未押し（全体）と視界とで比率の差を求める。 */
export async function listTagDiffByView(
  db: D1Database,
  entityId: string,
  view: ViewState,
  now: Date = new Date(),
): Promise<ViewDiff> {
  const [all, inView] = await Promise.all([
    listTagsByView(db, entityId, DEFAULT_VIEW, now),
    listTagsByView(db, entityId, view, now),
  ]);
  return diffTagShares(all, inView, { standardize: shouldStandardizeDiff(view) });
}

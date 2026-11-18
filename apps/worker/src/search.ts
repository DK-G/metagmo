import { InputError, LIMITS } from "./validate";

export interface SearchOptions {
  q: string;
  sort: "score_desc" | "newest";
}

export function parseSearch(params: URLSearchParams, defaultSort: SearchOptions["sort"]): SearchOptions {
  const q = (params.get("q") ?? "").trim();
  if ([...q].length > LIMITS.title) throw new InputError("q", "too_long");
  const sort = params.get("sort") ?? defaultSort;
  if (sort !== "score_desc" && sort !== "newest") throw new InputError("sort", "invalid");
  return { q, sort };
}

export interface EntitySearchRow {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
  score: number;
}

/**
 * ページの一覧。q はタイトルかタグの部分一致（大文字小文字を区別しない）、sort は新しい順かスコア順。
 * GET /api/entities とトップ `/` が同じこの関数を使う（Q-017。絞り込みと並びを 2 か所に書かない）。
 */
export async function searchEntities(db: D1Database, { q, sort }: SearchOptions, limit: number): Promise<EntitySearchRow[]> {
  const order = sort === "score_desc" ? "score DESC, e.created_at DESC, e.id" : "e.created_at DESC, e.id";
  const { results } = await db
    .prepare(
      `SELECT e.id, e.title, e.summary, e.created_at, e.updated_at,
       (SELECT COALESCE(SUM(CASE v.vote_type WHEN 'up' THEN 1 ELSE -1 END), 0)
        FROM tags t JOIN votes v ON v.tag_id = t.id WHERE t.entity_id = e.id) AS score
     FROM entities e
     WHERE ?1 = '' OR instr(lower(e.title), lower(?1)) > 0
       OR EXISTS (SELECT 1 FROM tags t WHERE t.entity_id = e.id AND instr(lower(t.tag_text), lower(?1)) > 0)
     ORDER BY ${order} LIMIT ?2`,
    )
    .bind(q, limit)
    .all<EntitySearchRow>();
  return results;
}

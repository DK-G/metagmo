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

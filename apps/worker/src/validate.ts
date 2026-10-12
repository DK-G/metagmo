// 入力検査。長さは SQLite の length() と同じく「文字数（コードポイント）」で数える。

export const LIMITS = {
  title: 200,
  summary: 1000,
  factContent: 2000,
  sourceUrl: 2048,
  sourceType: 32,
  tagText: 64, // migrations/0001_init.sql の CHECK と同じ
} as const;

export class InputError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

const charLength = (s: string) => [...s].length;

/** 前後の空白を落とした 1〜max 字の文字列。 */
export function requiredText(body: Record<string, unknown>, field: string, max: number): string {
  const raw = body[field];
  if (typeof raw !== "string") throw new InputError(field, "required");
  const text = raw.trim();
  if (text === "") throw new InputError(field, "required");
  if (charLength(text) > max) throw new InputError(field, "too_long");
  return text;
}

/** 無ければ null。あれば 1〜max 字。 */
export function optionalText(body: Record<string, unknown>, field: string, max: number): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new InputError(field, "invalid");
  const text = raw.trim();
  if (text === "") return null;
  if (charLength(text) > max) throw new InputError(field, "too_long");
  return text;
}

/** 出典 URL。http / https だけを受ける。 */
export function requiredHttpUrl(body: Record<string, unknown>, field: string, max: number): string {
  const text = requiredText(body, field, max);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new InputError(field, "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new InputError(field, "invalid_url");
  return text;
}

export function voteType(body: Record<string, unknown>, field: string): "up" | "down" {
  const raw = body[field];
  if (raw !== "up" && raw !== "down") throw new InputError(field, "invalid");
  return raw;
}

// 書き込みのテスト用ヘッダー。Turnstile は vitest.config.ts の外向き通信の代役が "pass" を通す。
// 流量制限に当たらないよう、接続元 IP は呼ぶたびに変える（制限そのものは guard.test.ts で確かめる）。
export const WRITE_HEADERS = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "X-Turnstile-Token": "pass",
  "CF-Connecting-IP": crypto.randomUUID(),
});

/* global console, process */
// 手元の D1 に、透明 BOT の印（votes.is_bot = 1）つきの票を入れる（Q-020・D-015）。
// 手元専用。wrangler に `--local` だけを渡し、`--remote` は受け付けない（本番に入れるのは公開後に運営が別に決める）。
//
//   npm --workspace apps/worker run bot-votes -- --tag <タグの id> --up 3 --down 1
//   npm --workspace apps/worker run bot-votes -- --tag <タグの id> --up 3 --dry-run   … SQL を出すだけ
//
// 先に手元の D1 に migration を当てておく（`npx wrangler d1 migrations apply metagmo --local`）。

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_NAME = "metagmo";

function fail(message) {
  console.error(`bot-votes: ${message}`);
  console.error("使い方: --tag <タグの id> [--up N] [--down N] [--dry-run]");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--remote")) fail("--remote は受け付けません。このスクリプトは手元の D1 専用です。");

const opts = { tag: "", up: 0, down: 0, dryRun: false };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--dry-run") opts.dryRun = true;
  else if (arg === "--tag") opts.tag = args[++i] ?? "";
  else if (arg === "--up" || arg === "--down") {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 0 || n > 1000) fail(`${arg} は 0〜1000 の整数で指定します。`);
    opts[arg.slice(2)] = n;
  } else fail(`知らない引数です: ${arg}`);
}
// タグの id は UUID（src/api.ts の crypto.randomUUID）。SQL に埋めるので形を確かめる。
if (!/^[0-9a-f-]{36}$/i.test(opts.tag)) fail("--tag にタグの id（UUID）を指定します。");
if (opts.up + opts.down === 0) fail("--up か --down で 1 票以上を指定します。");

const values = [
  ...Array.from({ length: opts.up }, () => "up"),
  ...Array.from({ length: opts.down }, () => "down"),
].map((type) => `('${randomUUID()}', '${opts.tag}', '${type}', 1)`);
const sql = `INSERT INTO votes (id, tag_id, vote_type, is_bot) SELECT * FROM (VALUES ${values.join(", ")}) WHERE EXISTS (SELECT 1 FROM tags WHERE id = '${opts.tag}');`;

if (opts.dryRun) {
  console.log(sql);
  process.exit(0);
}

// wrangler の package.json は bin を exports に載せていないので、package.json の場所から辿る。
const wranglerPkg = createRequire(import.meta.url).resolve("wrangler/package.json");
const wrangler = path.join(path.dirname(wranglerPkg), "bin", "wrangler.js");
execFileSync(process.execPath, [wrangler, "d1", "execute", DB_NAME, "--local", "--command", sql], {
  cwd: path.join(here, ".."),
  stdio: "inherit",
});
console.log(`bot-votes: タグ ${opts.tag} に BOT の票 up ${opts.up}・down ${opts.down} を入れました（手元の D1）。`);

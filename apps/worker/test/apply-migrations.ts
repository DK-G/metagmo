import { applyD1Migrations, env } from "cloudflare:test";

// テスト用の手元の D1 に migrations/ を当てる。適用済みの分は飛ばされる。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

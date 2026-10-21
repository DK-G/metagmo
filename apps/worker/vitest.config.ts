import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, TURNSTILE_SECRET_KEY: "test-secret" },
          // Worker の外向きの通信は外へ出さずにここで受ける。Turnstile は "pass" のトークンだけ通す。
          outboundService: async (request: Request) => {
            if (new URL(request.url).hostname !== "challenges.cloudflare.com") {
              return new Response("blocked in tests", { status: 502 });
            }
            const form = await request.formData();
            return Response.json({ success: form.get("secret") === "test-secret" && form.get("response") === "pass" });
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});

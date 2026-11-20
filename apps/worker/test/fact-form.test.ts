import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_HEADERS } from "./write-headers";

const BASE = "https://example.com";

async function newEntity(title: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary: "ファクトのフォームの試験ページ" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

/** ブラウザのフォーム送信と同じ形（urlencoded）で送る。リダイレクトは追わない。 */
const submit = (path: string, fields: Record<string, string>, ip: string = crypto.randomUUID()) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });

async function factCount(entityId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM facts WHERE entity_id = ?").bind(entityId).first<{ n: number }>();
  return row?.n ?? 0;
}

const PASS = { "cf-turnstile-response": "pass" };

describe("ファクトを足すフォーム（POST /p/:id/facts）", () => {
  it("送ると /p/:id へ 303 で戻り、ページにファクトと出典のリンクが出る", async () => {
    const id = await newEntity("フォームで足す");
    const res = await submit(`/p/${id}/facts`, {
      content: "2025 年度に指針が改訂された",
      source_url: "https://www.example.go.jp/guideline",
      source_type: "公式",
      ...PASS,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/p/${id}`);
    expect(await factCount(id)).toBe(1);

    const page = await (await SELF.fetch(`${BASE}/p/${id}`)).text();
    expect(page).toContain("2025 年度に指針が改訂された");
    expect(page).toContain('href="https://www.example.go.jp/guideline"');
    expect(page).toContain("出典 / 公式 / ");
  });

  it("種別を選ばなくても入る（source_type は NULL）", async () => {
    const id = await newEntity("種別なし");
    const res = await submit(`/p/${id}/facts`, { content: "事実", source_url: "http://example.com/a", source_type: "", ...PASS });
    expect(res.status).toBe(303);
    const row = await env.DB.prepare("SELECT source_type FROM facts WHERE entity_id = ?").bind(id).first<{ source_type: string | null }>();
    expect(row?.source_type).toBeNull();
  });

  it("出典 URL が空は 400 で入らず、理由と入力値がファクトのフォームに戻る", async () => {
    const id = await newEntity("出典なし");
    const res = await submit(`/p/${id}/facts`, { content: "出典の無い事実", source_url: "", source_type: "一次", ...PASS });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("出典 URL を入力してください");
    expect(html).toContain(">出典の無い事実</textarea>");
    expect(html).toContain('<option value="一次" selected>');
    // 理由はファクトのフォームにだけ出る（タグのフォームには出ない）
    const factForm = html.slice(html.indexOf('id="fact-form"'), html.indexOf("</form>", html.indexOf('id="fact-form"')));
    expect(factForm).toContain('class="form-error"');
    expect(html.match(/class="form-error"/g)?.length).toBe(1);
    expect(await factCount(id)).toBe(0);
  });

  it.each(["javascript:alert(1)", "ftp://example.com/x", "example.com/no-scheme"])("出典 URL が http(s) 以外（%s）は 400", async (url) => {
    const id = await newEntity("出典の形");
    const res = await submit(`/p/${id}/facts`, { content: "事実", source_url: url, ...PASS });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("http:// か https:// で始まる URL");
    expect(await factCount(id)).toBe(0);
  });

  it("本文が空は 400", async () => {
    const id = await newEntity("本文なし");
    const res = await submit(`/p/${id}/facts`, { content: "  ", source_url: "https://example.com/", ...PASS });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("ファクトの本文を入力してください。");
    expect(await factCount(id)).toBe(0);
  });

  it("トークンが無いと 403 で、理由と入力値つきのページが返りファクトは増えない", async () => {
    const id = await newEntity("トークン無し");
    const res = await submit(`/p/${id}/facts`, { content: "入らないはず", source_url: "https://example.com/x" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("ロボットでないことの確認");
    expect(html).toContain(">入らないはず</textarea>");
    expect(html).toContain('value="https://example.com/x"');
    expect(await factCount(id)).toBe(0);
  });

  it("存在しないページは 404", async () => {
    const res = await submit(`/p/no-such-page/facts`, { content: "x", source_url: "https://example.com/", ...PASS });
    expect(res.status).toBe(404);
  });

  it("GET は 405", async () => {
    const id = await newEntity("GET");
    const res = await SELF.fetch(`${BASE}/p/${id}/facts`);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("/p/:id の HTML にファクトのフォーム・価値判断を書かない注意・Turnstile のウィジェットがある", async () => {
    const id = await newEntity("フォームの有無");
    const html = await (await SELF.fetch(`${BASE}/p/${id}`)).text();
    expect(html).toContain(`<form class="fact-form" id="fact-form" method="post" action="/p/${id}/facts">`);
    expect(html).toContain('name="content" rows="3" maxlength="2000" required');
    expect(html).toContain('name="source_url" type="url" maxlength="2048" required');
    expect(html).toContain('name="source_type"');
    expect(html).toContain("良い・悪いの判断や推測は書かないでください");
    // ウィジェットはファクトとタグの 2 つ、読み込みの script は 1 つ
    expect(html.match(/class="cf-turnstile"/g)?.length).toBe(2);
    expect(html.match(/turnstile\/v0\/api\.js/g)?.length).toBe(1);
  });

  it("入力値はエスケープして戻す", async () => {
    const id = await newEntity("エスケープ");
    const res = await submit(`/p/${id}/facts`, { content: "</textarea><script>x</script>", source_url: "", ...PASS });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("&lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt;</textarea>");
  });
});

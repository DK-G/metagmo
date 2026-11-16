import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_HEADERS } from "./write-headers";
import { renderHomePage } from "../src/home";

const BASE = "https://example.com";

const get = (path: string, init?: RequestInit) => SELF.fetch(`${BASE}${path}`, init);

async function newEntity(title: string, summary: string, createdAt: string) {
  const res = await SELF.fetch(`${BASE}/api/entities`, {
    method: "POST",
    headers: WRITE_HEADERS(),
    body: JSON.stringify({ title, summary }),
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { entity: { id: string } }).entity.id;
  // 作成時刻を固定して、並びをミリ秒の偶然に任せない。
  await env.DB.prepare("UPDATE entities SET created_at = ? WHERE id = ?").bind(createdAt, id).run();
  return id;
}

describe("トップ（/）", () => {
  it("ページを新しい順に並べ、各 /p/:id へリンクする", async () => {
    const older = await newEntity("古いページ", "先に作ったページの要約。", "2026-10-01T00:00:00.000Z");
    const newer = await newEntity("新しいページ", "後から作ったページの要約。", "2026-10-02T00:00:00.000Z");

    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();

    expect(html).toContain("古いページ");
    expect(html).toContain("先に作ったページの要約。");
    expect(html).toContain("後から作ったページの要約。");
    expect(html).toContain(`href="/p/${newer}"`);
    expect(html).toContain(`href="/p/${older}"`);
    expect(html.indexOf(`href="/p/${newer}"`)).toBeLessThan(html.indexOf(`href="/p/${older}"`));
    expect(html).toContain('<link rel="canonical" href="https://example.com/">');
  });

  // 同じファイルのテストは D1 を共有するので、空の表は描画の関数で確かめる。
  it("ページが無い時は空の案内を出す", () => {
    const html = renderHomePage([], `${BASE}/`);
    expect(html).toContain("ページはまだありません。");
  });

  it("タイトルと要約をエスケープする", async () => {
    await newEntity("<script>x</script>", "a & b", "2026-10-03T00:00:00.000Z");
    const html = await (await get("/")).text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("GET 以外は 405", async () => {
    const res = await get("/", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
  });
});

// Q-017: トップの検索と並び替え。絞り込みと並びは GET /api/entities と同じ関数なので、結果を API と突き合わせる。
describe("トップの検索と並び替え（?q= / ?sort=）", () => {
  const postJson = async (path: string, body: unknown) => {
    const res = await SELF.fetch(`${BASE}${path}`, { method: "POST", headers: WRITE_HEADERS(), body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    return res.json();
  };
  const addTag = async (entityId: string, tagText: string) =>
    ((await postJson(`/api/entities/${entityId}/tags`, { tag_text: tagText })) as { tag: { id: string } }).tag.id;
  const vote = (tagId: string, voteType: "up" | "down") => postJson(`/api/tags/${tagId}/vote`, { vote_type: voteType });

  // 一覧に出た /p/:id の順（ヒーローや見出しのリンクは /p/ を含まない）。
  const linkedIds = (html: string) => [...html.matchAll(/href="\/p\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  const apiIds = async (query: string) =>
    ((await (await get(`/api/entities${query}`)).json()) as { entities: { id: string }[] }).entities.map((e) => e.id);

  it("?q= でタイトル一致・タグ一致のページだけを出す", async () => {
    const byTitle = await newEntity("検索Q017山の本", "タイトルで当たる。", "2026-11-01T00:00:00.000Z");
    const byTag = await newEntity("別の題", "タグで当たる。", "2026-11-02T00:00:00.000Z");
    await addTag(byTag, "検索q017山");
    const miss = await newEntity("検索に当たらない", "どちらでも当たらない。", "2026-11-03T00:00:00.000Z");

    const res = await get(`/?q=${encodeURIComponent("検索Q017山")}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const ids = linkedIds(html);
    expect(ids).toContain(byTitle);
    expect(ids).toContain(byTag);
    expect(ids).not.toContain(miss);
    expect(ids).toEqual(await apiIds(`?q=${encodeURIComponent("検索Q017山")}`));
    // 入力欄に今の語が残る。
    expect(html).toContain('value="検索Q017山"');
  });

  it("sort=score_desc の順が API と同じ", async () => {
    const low = await newEntity("並びQ017低", "票が少ない。", "2026-11-04T00:00:00.000Z");
    const high = await newEntity("並びQ017高", "票が多い。", "2026-11-05T00:00:00.000Z");
    const neg = await newEntity("並びQ017負", "反対が多い。", "2026-11-06T00:00:00.000Z");
    const tLow = await addTag(low, "a");
    const tHigh = await addTag(high, "b");
    const tNeg = await addTag(neg, "c");
    await vote(tLow, "up");
    await vote(tHigh, "up");
    await vote(tHigh, "up");
    await vote(tNeg, "down");

    const q = encodeURIComponent("並びQ017");
    const ids = linkedIds(await (await get(`/?q=${q}&sort=score_desc`)).text());
    expect(ids).toEqual([high, low, neg]);
    expect(ids).toEqual(await apiIds(`?q=${q}&sort=score_desc`));
    // 並びの切り替えに今の値が選ばれている。
    expect(await (await get(`/?sort=score_desc`)).text()).toContain('<option value="score_desc" selected>');
  });

  it("不正な sort は 400 の HTML", async () => {
    const res = await get("/?sort=oldest");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("並びの指定が正しくありません");
  });

  it("canonical は検索・並びの値によらず値なしの /", async () => {
    const html = await (await get("/?q=abc&sort=score_desc")).text();
    expect(html).toContain('<link rel="canonical" href="https://example.com/">');
    expect(html).toContain('<meta property="og:url" content="https://example.com/">');
  });

  it("0 件の時はその旨と /new へのリンク", async () => {
    const html = await (await get(`/?q=${encodeURIComponent("どこにも無い語Q017")}`)).text();
    expect(html).toContain("「どこにも無い語Q017」に当たるページはありません。");
    expect(html).toContain('href="/new"');
    expect(linkedIds(html)).toEqual([]);
  });

  it("検索欄は JS なしの GET フォームで / へ送る", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('<form class="home-search" method="get" action="/" role="search">');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="sort"');
  });

  it("検索の語はエスケープして入力欄と見出しに出す", async () => {
    const html = await (await get(`/?q=${encodeURIComponent('"><b>x')}`)).text();
    expect(html).not.toContain('"><b>x');
    expect(html).toContain("&quot;&gt;&lt;b&gt;x");
  });
});

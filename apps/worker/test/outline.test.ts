import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_HEADERS } from "./write-headers";
import { outlineLabels, outlineSides, renderOutline } from "../src/outline";
import type { ViewTag } from "../src/views";

const BASE = "https://example.com";

const get = (path: string) => SELF.fetch(`${BASE}${path}`);
const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, { method: "POST", headers: WRITE_HEADERS(), body: JSON.stringify(body) });

async function newEntity(title: string) {
  const res = await post("/api/entities", { title, summary: "輪郭の確認。" });
  return ((await res.json()) as { entity: { id: string } }).entity.id;
}

async function newTag(entityId: string, tagText: string, ups: number, downs: number) {
  const res = await post(`/api/entities/${entityId}/tags`, { tag_text: tagText });
  const tagId = ((await res.json()) as { tag: { id: string } }).tag.id;
  for (let i = 0; i < ups; i++) await post(`/api/tags/${tagId}/vote`, { vote_type: "up" });
  for (let i = 0; i < downs; i++) await post(`/api/tags/${tagId}/vote`, { vote_type: "down" });
}

const tag = (id: string, up: number, down: number): ViewTag => ({
  id,
  entity_id: "e",
  tag_text: id,
  created_at: "2026-11-03T00:00:00Z",
  up,
  down,
  score: up - down,
});

/** 輪郭の SVG の中にある polygon の class を、出てくる順に返す。 */
const polygons = (html: string) => [...html.matchAll(/<polygon class="([^"]+)"/g)].map((m) => m[1]);

describe("輪郭の部品（D-013）", () => {
  it("ラベルは総票数の多い順に上位 12、票の無いタグは入れない、同数は元の順", () => {
    const tags = [tag("a", 1, 0), tag("b", 3, 3), tag("c", 0, 0), tag("d", 0, 1)];
    expect(outlineLabels(tags).map((t) => t.id)).toEqual(["b", "a", "d"]);
    const many = Array.from({ length: 15 }, (_, i) => tag(`t${i}`, i + 1, 0));
    const labels = outlineLabels(many);
    expect(labels).toHaveLength(12);
    expect(labels[0].id).toBe("t14");
  });

  it("比率は 12 ラベルの票の合計で割り、視界で消えたラベルは 0、票が無ければ null", () => {
    const all = [tag("a", 6, 0), tag("b", 2, 2)];
    const labels = outlineLabels(all);
    expect(outlineSides(labels, all)).toEqual({ left: [0.6, 0.2], right: [0, 0.2] });
    expect(outlineSides(labels, [tag("b", 1, 3)])).toEqual({ left: [0, 0.25], right: [0, 0.75] });
    expect(outlineSides(labels, [])).toBeNull();
  });

  it("ラベルが 3 つ未満なら図を出さない", () => {
    expect(renderOutline([tag("a", 1, 0), tag("b", 1, 1)], null)).toBe("");
  });

  it("未押しは全体を塗るだけ、押した視界は全体の薄い線を重ね、視界に票が無ければ薄い線だけ", () => {
    const all = [tag("a", 4, 0), tag("b", 2, 2), tag("c", 0, 3)];
    expect(polygons(renderOutline(all, null))).toEqual(["outline-up", "outline-down"]);
    expect(polygons(renderOutline(all, [tag("a", 4, 0)]))).toEqual(["outline-all", "outline-up", "outline-down"]);
    expect(polygons(renderOutline(all, []))).toEqual(["outline-all"]);
  });

  it("賛成だけのページは右側が中心の線に張り付く", () => {
    const svg = renderOutline([tag("a", 4, 0), tag("b", 2, 0), tag("c", 1, 0)], null);
    const right = /<polygon class="outline-down" points="([^"]+)"/.exec(svg)![1];
    expect(right.split(" ").every((p) => p.startsWith("120,"))).toBe(true);
    // 左の最長（a）は半幅いっぱい＝ x 10。
    expect(svg).toContain("10,8");
  });

  it("SVG に文字を入れない", () => {
    const svg = renderOutline([tag("a", 4, 0), tag("b", 2, 2), tag("c", 0, 3)], null);
    const inner = svg.slice(svg.indexOf("<svg"), svg.indexOf("</svg>"));
    expect(inner).not.toMatch(/<text|<title/);
  });
});

describe("ページの輪郭（/p/:id）", () => {
  it("雲の上に輪郭が 1 枚出る", async () => {
    const id = await newEntity("輪郭あり");
    await newTag(id, "合意", 4, 0);
    await newTag(id, "割れ", 2, 2);
    await newTag(id, "拒否", 0, 3);
    const html = await (await get(`/p/${id}`)).text();
    const at = html.indexOf('<figure class="page-outline">');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf('<div class="cloud"'));
    expect(polygons(html)).toEqual(["outline-up", "outline-down"]);
  });

  it("視界を押すと全体の輪郭を薄く重ねる", async () => {
    const id = await newEntity("輪郭の視界");
    await newTag(id, "合意", 4, 0);
    await newTag(id, "割れ", 2, 2);
    await newTag(id, "拒否", 0, 3);
    const html = await (await get(`/p/${id}?consensus=1`)).text();
    expect(polygons(html)).toEqual(["outline-all", "outline-up", "outline-down"]);
    expect(html).toContain("薄い線は全体の輪郭です。");
  });

  it("票のあるタグが 2 つなら輪郭を出さない", async () => {
    const id = await newEntity("輪郭なし");
    await newTag(id, "合意", 4, 0);
    await newTag(id, "割れ", 2, 2);
    const html = await (await get(`/p/${id}`)).text();
    expect(html).not.toContain("page-outline\">");
  });
});

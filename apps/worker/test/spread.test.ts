import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WRITE_HEADERS } from "./write-headers";
import { renderSpread, voteSpread } from "../src/spread";
import type { ViewTag } from "../src/views";

const BASE = "https://example.com";

const get = (path: string) => SELF.fetch(`${BASE}${path}`);
const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, { method: "POST", headers: WRITE_HEADERS(), body: JSON.stringify(body) });

async function newEntity(title: string) {
  const res = await post("/api/entities", { title, summary: "帯の確認。" });
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
  created_at: "2026-11-10T00:00:00Z",
  up,
  down,
  score: up - down,
});

/** D-013 と同じ見本 8 タグ。 */
const SAMPLE = [
  tag("a", 18, 2),
  tag("b", 10, 10),
  tag("c", 12, 3),
  tag("d", 3, 9),
  tag("e", 7, 1),
  tag("f", 1, 0),
  tag("g", 0, 5),
  tag("h", 6, 6),
];

const classes = (html: string) => [...html.matchAll(/<(?:rect|line) class="([^"]+)"/g)].map((m) => m[1]);

describe("票の集まり方の部品（D-014）", () => {
  it("見本 8 タグ: ラベル 8、実質 8649/1403、出そろい度 1 − 1/93", () => {
    const s = voteSpread(SAMPLE)!;
    expect(s.labels).toBe(8);
    expect(s.votes).toBe(93);
    expect(s.effective).toBeCloseTo(8649 / 1403, 10);
    expect(s.coverage).toBeCloseTo(1 - 1 / 93, 10);
  });

  it("票が均等なら実質＝ラベル数、1 つに集中すれば 1 に近い", () => {
    expect(voteSpread([tag("a", 2, 2), tag("b", 4, 0), tag("c", 0, 4)])!.effective).toBeCloseTo(3, 10);
    expect(voteSpread([tag("a", 98, 0), tag("b", 1, 0), tag("c", 1, 0)])!.effective).toBeLessThan(1.1);
  });

  it("票の無いタグは数えず、票が無ければ null", () => {
    expect(voteSpread([tag("a", 1, 1), tag("b", 0, 0)])!.labels).toBe(1);
    expect(voteSpread([tag("a", 0, 0)])).toBeNull();
    expect(voteSpread([])).toBeNull();
  });

  it("1 票だけのタグが多いと出そろい度が 0.8 未満になり、端が点線になる", () => {
    const thin = [tag("a", 1, 0), tag("b", 0, 1), tag("c", 1, 0), tag("d", 2, 1)];
    expect(voteSpread(thin)!.coverage).toBeCloseTo(1 - 3 / 6, 10);
    const svg = renderSpread(thin, null);
    expect(classes(svg)).toContain("spread-end spread-open");
    expect(svg).toContain("まだ絵が固まっていません");
    const solid = renderSpread(SAMPLE, null);
    expect(classes(solid)).toContain("spread-end");
    expect(classes(solid)).not.toContain("spread-end spread-open");
    expect(solid).not.toContain("まだ絵が固まっていません");
  });

  it("全体で票のあるタグが 3 つ未満なら帯を出さない（輪郭と同じ）", () => {
    expect(renderSpread([tag("a", 1, 0), tag("b", 1, 1)], null)).toBe("");
  });

  it("未押しは全体を塗るだけ、押した視界は全体の薄い枠を重ね、視界に票が無ければ薄い枠だけ", () => {
    expect(classes(renderSpread(SAMPLE, null))).toEqual(["spread-labels", "spread-effective", "spread-end"]);
    expect(classes(renderSpread(SAMPLE, [tag("a", 18, 2)]))).toEqual([
      "spread-labels",
      "spread-effective",
      "spread-end",
      "spread-all",
      "spread-all-effective",
    ]);
    const empty = renderSpread(SAMPLE, []);
    expect(classes(empty)).toEqual(["spread-all", "spread-all-effective"]);
    expect(empty).toContain("この視界には票がありません。");
  });

  it("全幅は票のあるラベルの数に比例し、実質の幅はそれより短い", () => {
    const svg = renderSpread(SAMPLE, null);
    const width = (cls: string) => Number(new RegExp(`class="${cls}"[^>]*width="([^"]+)"`).exec(svg)![1]);
    expect(width("spread-labels")).toBe(240);
    expect(width("spread-effective")).toBeCloseTo((240 * 8649) / 1403 / 8, 0);
    // 視界のラベルが半分なら、全体の物差しで半分の幅。
    const half = renderSpread(SAMPLE, SAMPLE.slice(0, 4));
    const w = Number(/class="spread-labels"[^>]*width="([^"]+)"/.exec(half)![1]);
    expect(w).toBe(120);
  });

  it("SVG に文字を入れない", () => {
    const svg = renderSpread(SAMPLE, null);
    const inner = svg.slice(svg.indexOf("<svg"), svg.indexOf("</svg>"));
    expect(inner).not.toMatch(/<text|<title/);
  });
});

describe("票の集まり方（/p/:id）", () => {
  it("輪郭の下、雲の上に帯が 1 本出る", async () => {
    const id = await newEntity("帯あり");
    await newTag(id, "合意", 4, 0);
    await newTag(id, "割れ", 2, 2);
    await newTag(id, "拒否", 0, 3);
    const html = await (await get(`/p/${id}`)).text();
    const outline = html.indexOf('<figure class="page-outline">');
    const at = html.indexOf('<figure class="vote-spread">');
    expect(at).toBeGreaterThan(outline);
    expect(outline).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf('<div class="cloud"'));
    expect(html).toContain("票のあるタグ 3 個のうち、実質 3.0 個");
  });

  it("視界を押すと全体の帯を薄く重ねる", async () => {
    const id = await newEntity("帯の視界");
    await newTag(id, "合意", 4, 0);
    await newTag(id, "割れ", 2, 2);
    await newTag(id, "拒否", 0, 3);
    const html = await (await get(`/p/${id}?consensus=1`)).text();
    expect(classes(html)).toContain("spread-all");
    expect(html).toContain("薄い枠は全体です。");
  });

  it("票のあるタグが 2 つなら帯を出さない", async () => {
    const id = await newEntity("帯なし");
    await newTag(id, "合意", 4, 0);
    await newTag(id, "割れ", 2, 2);
    const html = await (await get(`/p/${id}`)).text();
    expect(html).not.toContain('vote-spread">');
  });
});

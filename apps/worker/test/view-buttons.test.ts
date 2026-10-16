import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nextMode, renderViewButtons, viewButtonLinks, viewQuery, VIEW_BUTTONS } from "../src/view-buttons";
import { DEFAULT_VIEW, listTagsByView, parseViewState, type ViewState } from "../src/views";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const PATH = "/p/abc";

/** リンクの href を、Worker が受け取る時と同じように読み直す。 */
function follow(href: string): ViewState {
  const parsed = parseViewState(new URL(href, "https://example.test").searchParams);
  if (!parsed.ok) throw new Error(`bad view in ${href}`);
  return parsed.view;
}

const linkOf = (view: ViewState, id: keyof ViewState) => viewButtonLinks(view, PATH).find((b) => b.id === id)!;

describe("nextMode", () => {
  it("未押し → 1 回目 → 2 回目 → 未押し を循環する", () => {
    expect(nextMode(0)).toBe(1);
    expect(nextMode(1)).toBe(2);
    expect(nextMode(2)).toBe(0);
  });
});

describe("viewQuery", () => {
  it("全部未押しなら値を付けない", () => {
    expect(viewQuery(DEFAULT_VIEW)).toBe("");
  });

  it("未押しの項目は書かず、押された項目だけ書く", () => {
    expect(viewQuery({ recent: 1, consensus: 0, controversy: 2 })).toBe("?recent=1&controversy=2");
  });
});

describe("viewButtonLinks", () => {
  it("試作と同じ 3 ボタン・同じラベルを並べる", () => {
    expect(VIEW_BUTTONS.map((b) => b.label)).toEqual(["直近一週間", "合意", "論争"]);
    expect(viewButtonLinks(DEFAULT_VIEW, PATH).map((b) => b.stateLabel)).toEqual(["全期間", "すべて", "すべて"]);
  });

  it("ボタンを 3 回押すと 3 状態を回って未押しへ戻る", () => {
    for (const { id, states } of VIEW_BUTTONS) {
      let view = DEFAULT_VIEW;
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        seen.push(linkOf(view, id).stateLabel);
        view = follow(linkOf(view, id).href);
      }
      expect(seen).toEqual([...states]);
      expect(view).toEqual(DEFAULT_VIEW);
      expect(linkOf(view, id).href).toBe(`${PATH}?${id}=1`);
    }
  });

  it("押したボタンだけが進み、他のボタンの状態は保たれる", () => {
    const view: ViewState = { recent: 1, consensus: 2, controversy: 0 };
    expect(follow(linkOf(view, "controversy").href)).toEqual({ recent: 1, consensus: 2, controversy: 1 });
    expect(follow(linkOf(view, "consensus").href)).toEqual({ recent: 1, consensus: 0, controversy: 0 });
  });
});

describe("renderViewButtons", () => {
  it("今の状態の class と表示名、次の状態へのリンクを出す", () => {
    const html = renderViewButtons({ recent: 0, consensus: 1, controversy: 2 }, PATH);
    expect(html).toContain('aria-label="視界ボタン"');
    expect(html.match(/<a class="view-button/g)).toHaveLength(3);
    expect(html).toContain(
      '<a class="view-button state-0" href="/p/abc?recent=1&amp;consensus=1&amp;controversy=2" data-view="recent" data-state="0"><span>直近一週間</span><strong>全期間</strong></a>',
    );
    expect(html).toContain('class="view-button state-1" href="/p/abc?consensus=2&amp;controversy=2"');
    expect(html).toContain("<strong>合意</strong>");
    expect(html).toContain('class="view-button state-2" href="/p/abc?consensus=1"');
    expect(html).toContain("<strong>決着済み</strong>");
  });

  it("パスに混じった記号はエスケープする", () => {
    expect(renderViewButtons(DEFAULT_VIEW, '/p/"x<')).toContain('href="/p/&quot;x&lt;?recent=1"');
  });
});

describe("押した後に表示タグが変わる", () => {
  it("ボタンのリンク先の視界で集計すると、タグの組が変わる", async () => {
    const entityId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO entities (id, title, summary) VALUES (?, 't', 's')").bind(entityId).run();
    const tag = async (text: string, votes: ["up" | "down", string][]) => {
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO tags (id, entity_id, tag_text, created_at) VALUES (?, ?, ?, ?)").bind(
          id,
          entityId,
          text,
          daysAgo(30),
        ),
        ...votes.map(([type, at]) =>
          env.DB.prepare("INSERT INTO votes (id, tag_id, vote_type, created_at) VALUES (?, ?, ?, ?)").bind(
            crypto.randomUUID(),
            id,
            type,
            at,
          ),
        ),
      ]);
    };
    // 合意: 全期間で 3 票すべて up（うち 1 票だけ直近）。論争: 2 up 2 down（すべて古い）。
    await tag("合意", [
      ["up", daysAgo(1)],
      ["up", daysAgo(20)],
      ["up", daysAgo(20)],
    ]);
    await tag("論争", [
      ["up", daysAgo(20)],
      ["up", daysAgo(20)],
      ["down", daysAgo(20)],
      ["down", daysAgo(20)],
    ]);
    const texts = async (view: ViewState) =>
      (await listTagsByView(env.DB, entityId, view, NOW)).map((t) => t.tag_text).sort();

    expect(await texts(DEFAULT_VIEW)).toEqual(["合意", "論争"]);
    const consensus = follow(linkOf(DEFAULT_VIEW, "consensus").href);
    expect(await texts(consensus)).toEqual(["合意"]);
    const controversy = follow(linkOf(DEFAULT_VIEW, "controversy").href);
    expect(await texts(controversy)).toEqual(["論争"]);
    const recent = follow(linkOf(DEFAULT_VIEW, "recent").href);
    expect(await texts(recent)).toEqual(["合意"]);
    // 3 回押して未押しへ戻ると、元の組に戻る。
    const back = follow(linkOf(follow(linkOf(consensus, "consensus").href), "consensus").href);
    expect(await texts(back)).toEqual(["合意", "論争"]);
  });
});

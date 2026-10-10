"use client";

import { useMemo, useState } from "react";

const MIN_VOTES = 3;

const SEED_ENTITIES = [
  {
    id: "ai-learning",
    title: "生成AIと学習",
    type: "社会・教育",
    summary:
      "学習者が生成AIを使うことについて、事実と印象を分けて見えるようにする試験ページ。",
    facts: [
      {
        id: "f1",
        body: "文部科学省は教育現場での生成AI利用について、発達段階や利用場面に応じた扱いを求めている。",
        sourceUrl: "https://www.mext.go.jp/",
        createdAt: "2026-05-01",
      },
      {
        id: "f2",
        body: "大学や学校では、レポート作成・調査・プログラミング支援などで生成AI利用ルールの整備が進んでいる。",
        sourceUrl: "https://example.com/education-ai-policy",
        createdAt: "2026-05-04",
      },
      {
        id: "f3",
        body: "生成AIの回答には誤情報が含まれる場合があり、出典確認や利用過程の説明が重要とされる。",
        sourceUrl: "https://example.com/ai-literacy",
        createdAt: "2026-05-06",
      },
    ],
    tags: [
      { id: "t1", text: "調べる入口として便利", up: 18, down: 4, recentUp: 9, recentDown: 1, createdAt: "2026-05-06" },
      { id: "t2", text: "考える力が落ちそう", up: 11, down: 9, recentUp: 5, recentDown: 5, createdAt: "2026-05-07" },
      { id: "t3", text: "出典確認が前提", up: 21, down: 2, recentUp: 4, recentDown: 1, createdAt: "2026-04-20" },
      { id: "t4", text: "先生側の設計が大事", up: 14, down: 3, recentUp: 8, recentDown: 1, createdAt: "2026-05-08" },
      { id: "t5", text: "ズルとの線引きが曖昧", up: 10, down: 8, recentUp: 2, recentDown: 4, createdAt: "2026-04-28" },
      { id: "t6", text: "個別最適化に向いている", up: 8, down: 3, recentUp: 1, recentDown: 0, createdAt: "2026-04-18" },
      { id: "t7", text: "格差が広がる", up: 7, down: 6, recentUp: 6, recentDown: 4, createdAt: "2026-05-08" },
      { id: "t8", text: "まず触って覚えるべき", up: 13, down: 5, recentUp: 10, recentDown: 3, createdAt: "2026-05-05" },
    ],
  },
  {
    id: "local-tourism",
    title: "地方観光とSNS",
    type: "地域・文化",
    summary:
      "SNSによる観光地化が地域にもたらす利益と負担を、ファクトとタグで分けて眺めるページ。",
    facts: [
      {
        id: "f4",
        body: "観光庁は地域観光において、混雑対策や住民生活との両立を政策課題として扱っている。",
        sourceUrl: "https://www.mlit.go.jp/kankocho/",
        createdAt: "2026-04-24",
      },
      {
        id: "f5",
        body: "SNS投稿をきっかけに短期間で来訪者が増える地域では、交通・ごみ・私有地侵入が課題になることがある。",
        sourceUrl: "https://example.com/local-tourism-social",
        createdAt: "2026-04-30",
      },
    ],
    tags: [
      { id: "t9", text: "経済効果がある", up: 16, down: 5, recentUp: 3, recentDown: 1, createdAt: "2026-04-26" },
      { id: "t10", text: "暮らしへの負担が重い", up: 13, down: 4, recentUp: 7, recentDown: 1, createdAt: "2026-05-06" },
      { id: "t11", text: "マナー設計が必要", up: 22, down: 2, recentUp: 9, recentDown: 0, createdAt: "2026-05-03" },
      { id: "t12", text: "一過性で終わりやすい", up: 6, down: 8, recentUp: 1, recentDown: 5, createdAt: "2026-05-08" },
      { id: "t13", text: "地元発信なら強い", up: 10, down: 3, recentUp: 2, recentDown: 0, createdAt: "2026-04-22" },
    ],
  },
];

const VIEW_BUTTONS = [
  {
    id: "recent",
    label: "直近一週間",
    states: ["全期間", "7日以内", "7日より前"],
  },
  {
    id: "consensus",
    label: "合意",
    states: ["すべて", "合意", "拒否"],
  },
  {
    id: "controversy",
    label: "論争",
    states: ["すべて", "論争", "決着済み"],
  },
];

function score(tag, mode) {
  if (mode === 1) return tag.recentUp - tag.recentDown;
  if (mode === 2) return tag.up - tag.down - (tag.recentUp - tag.recentDown);
  return tag.up - tag.down;
}

function counts(tag, mode) {
  if (mode === 1) return { up: tag.recentUp, down: tag.recentDown };
  if (mode === 2) {
    return {
      up: Math.max(0, tag.up - tag.recentUp),
      down: Math.max(0, tag.down - tag.recentDown),
    };
  }
  return { up: tag.up, down: tag.down };
}

function ratio(up, down) {
  const total = up + down;
  return total === 0 ? 0 : up / total;
}

function matchesView(tag, viewState) {
  const recentMode = viewState.recent;
  const { up, down } = counts(tag, recentMode);
  const total = up + down;
  const upRatio = ratio(up, down);

  if (viewState.consensus === 1 && !(upRatio >= 0.7 && total >= MIN_VOTES)) return false;
  if (viewState.consensus === 2 && !(upRatio <= 0.3 && total >= MIN_VOTES)) return false;
  if (viewState.controversy === 1 && !(upRatio >= 0.3 && upRatio <= 0.7 && total >= MIN_VOTES)) return false;
  if (viewState.controversy === 2 && !((upRatio < 0.3 || upRatio > 0.7) && total >= MIN_VOTES)) return false;

  return total > 0;
}

function nextState(current) {
  return current === 2 ? 0 : current + 1;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(value));
}

export default function Home() {
  const [entities, setEntities] = useState(SEED_ENTITIES);
  const [entityId, setEntityId] = useState(SEED_ENTITIES[0].id);
  const [viewState, setViewState] = useState({ recent: 0, consensus: 0, controversy: 0 });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("score_desc");
  const [newTag, setNewTag] = useState("");
  const [newFact, setNewFact] = useState("");
  const [newSource, setNewSource] = useState("");

  const entity = entities.find((item) => item.id === entityId) ?? entities[0];

  const visibleTags = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = entity.tags
      .filter((tag) => !normalizedQuery || tag.text.toLowerCase().includes(normalizedQuery))
      .filter((tag) => matchesView(tag, viewState));

    return filtered.sort((a, b) => {
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return score(b, viewState.recent) - score(a, viewState.recent);
    });
  }, [entity, query, sort, viewState]);

  const maxScore = Math.max(1, ...visibleTags.map((tag) => Math.abs(score(tag, viewState.recent))));

  function updateEntity(updater) {
    setEntities((current) =>
      current.map((item) => (item.id === entity.id ? updater(item) : item))
    );
  }

  function vote(tagId, value) {
    updateEntity((item) => ({
      ...item,
      tags: item.tags.map((tag) =>
        tag.id === tagId
          ? {
              ...tag,
              up: tag.up + (value === "up" ? 1 : 0),
              down: tag.down + (value === "down" ? 1 : 0),
              recentUp: tag.recentUp + (value === "up" ? 1 : 0),
              recentDown: tag.recentDown + (value === "down" ? 1 : 0),
            }
          : tag
      ),
    }));
  }

  function addTag(event) {
    event.preventDefault();
    const text = newTag.trim();
    if (!text) return;
    updateEntity((item) => ({
      ...item,
      tags: [
        {
          id: `tag-${Date.now()}`,
          text: text.slice(0, 64),
          up: 1,
          down: 0,
          recentUp: 1,
          recentDown: 0,
          createdAt: new Date().toISOString(),
        },
        ...item.tags,
      ],
    }));
    setNewTag("");
  }

  function addFact(event) {
    event.preventDefault();
    const body = newFact.trim();
    const sourceUrl = newSource.trim();
    if (!body || !sourceUrl) return;
    updateEntity((item) => ({
      ...item,
      facts: [
        {
          id: `fact-${Date.now()}`,
          body,
          sourceUrl,
          createdAt: new Date().toISOString(),
        },
        ...item.facts,
      ],
    }));
    setNewFact("");
    setNewSource("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="メタグモ ホーム">
          <span className="brand-mark">M</span>
          <span>メタグモ</span>
        </a>
        <div className="entity-switcher" aria-label="対象ページの切り替え">
          {entities.map((item) => (
            <button
              key={item.id}
              className={item.id === entity.id ? "selected" : ""}
              onClick={() => setEntityId(item.id)}
              type="button"
            >
              {item.title}
            </button>
          ))}
        </div>
      </header>

      <section className="entity-hero" id="top">
        <div>
          <p className="entity-type">{entity.type}</p>
          <h1>{entity.title}</h1>
          <p>{entity.summary}</p>
        </div>
        <div className="hero-stats" aria-label="現在のページ統計">
          <div>
            <strong>{entity.facts.length}</strong>
            <span>Facts</span>
          </div>
          <div>
            <strong>{entity.tags.length}</strong>
            <span>Tags</span>
          </div>
          <div>
            <strong>{visibleTags.length}</strong>
            <span>Visible</span>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <aside className="facts-panel">
          <div className="section-title">
            <h2>Facts</h2>
            <p>先に事実を置き、印象はタグで分けます。</p>
          </div>
          <div className="facts-list">
            {entity.facts.map((fact) => (
              <article key={fact.id} className="fact-item">
                <p>{fact.body}</p>
                <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
                  出典 / {formatDate(fact.createdAt)}
                </a>
              </article>
            ))}
          </div>
          <form className="fact-form" onSubmit={addFact}>
            <label htmlFor="fact-body">ファクトを追加</label>
            <textarea
              id="fact-body"
              value={newFact}
              onChange={(event) => setNewFact(event.target.value)}
              placeholder="検証可能な事実を短く入力"
              rows="3"
            />
            <input
              value={newSource}
              onChange={(event) => setNewSource(event.target.value)}
              placeholder="出典URL"
              type="url"
            />
            <button type="submit">追加</button>
          </form>
        </aside>

        <section className="tag-experience" aria-label="タグ視界">
          <div className="toolbar">
            <div>
              <h2>Word Cloud</h2>
              <p>ボタンを押すと、同じタグ群の見え方が変わります。</p>
            </div>
            <div className="toolbar-controls">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="タグ検索"
                type="search"
              />
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="score_desc">スコア順</option>
                <option value="newest">新着順</option>
              </select>
            </div>
          </div>

          <div className="view-controls" aria-label="視界ボタン">
            {VIEW_BUTTONS.map((button) => {
              const state = viewState[button.id];
              return (
                <button
                  key={button.id}
                  className={`view-button state-${state}`}
                  onClick={() =>
                    setViewState((current) => ({
                      ...current,
                      [button.id]: nextState(current[button.id]),
                    }))
                  }
                  type="button"
                >
                  <span>{button.label}</span>
                  <strong>{button.states[state]}</strong>
                </button>
              );
            })}
          </div>

          <div className="cloud" aria-label="タグワードクラウド">
            {visibleTags.length === 0 ? (
              <div className="empty-state">この視界に一致するタグはまだありません。</div>
            ) : (
              visibleTags.map((tag) => {
                const tagScore = score(tag, viewState.recent);
                const { up, down } = counts(tag, viewState.recent);
                const size = 18 + Math.round((Math.abs(tagScore) / maxScore) * 38);
                return (
                  <button
                    key={tag.id}
                    className={tagScore < 0 ? "cloud-word negative" : "cloud-word"}
                    style={{ "--size": `${size}px` }}
                    onClick={() => vote(tag.id, "up")}
                    title={`👍${up} 👎${down} 合計${up + down}`}
                    type="button"
                  >
                    {tag.text}
                    <small>👍{up} 👎{down}</small>
                  </button>
                );
              })
            )}
          </div>

          <div className="tag-list">
            {visibleTags.map((tag) => {
              const { up, down } = counts(tag, viewState.recent);
              return (
                <article key={tag.id} className="tag-row">
                  <div>
                    <h3>{tag.text}</h3>
                    <p>net {up - down} / total {up + down}</p>
                  </div>
                  <div className="vote-buttons">
                    <button onClick={() => vote(tag.id, "up")} type="button">👍 {up}</button>
                    <button onClick={() => vote(tag.id, "down")} type="button">👎 {down}</button>
                  </div>
                </article>
              );
            })}
          </div>

          <form className="tag-form" onSubmit={addTag}>
            <label htmlFor="tag-input">タグを追加</label>
            <div>
              <input
                id="tag-input"
                value={newTag}
                maxLength={64}
                onChange={(event) => setNewTag(event.target.value)}
                placeholder="例: 出典確認が前提"
              />
              <button type="submit">投稿</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}

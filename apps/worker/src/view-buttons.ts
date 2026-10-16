// R1-4 視界 3 ボタンの画面側。ラベルと 3 状態の名前は docs/prototype/page.jsx の VIEW_BUTTONS を写した。
// ボタンは JS を使わないリンクで、押すと次の状態を URL の値（?recent= など）に入れたページへ移る（D-005 の仮の答え）。
// ページ（Q-005 の handlePage）へのはめ込みは、その枝が main に入ってから行う。

import type { ViewMode, ViewState } from "./views";

export interface ViewButtonDef {
  id: keyof ViewState;
  label: string;
  /** 未押し・1 回目・2 回目の表示名。 */
  states: readonly [string, string, string];
}

export const VIEW_BUTTONS: readonly ViewButtonDef[] = [
  { id: "recent", label: "直近一週間", states: ["全期間", "7日以内", "7日より前"] },
  { id: "consensus", label: "合意", states: ["すべて", "合意", "拒否"] },
  { id: "controversy", label: "論争", states: ["すべて", "論争", "決着済み"] },
];

/** 未押し → 1 回目 → 2 回目 → 未押し（metagmo_spec.md 2.1）。 */
export const nextMode = (mode: ViewMode): ViewMode => (mode === 2 ? 0 : ((mode + 1) as ViewMode));

/** 視界を URL の値にする。未押しの項目は書かない。全部未押しなら空文字。 */
export function viewQuery(view: ViewState): string {
  const params = new URLSearchParams();
  for (const { id } of VIEW_BUTTONS) {
    if (view[id] !== 0) params.set(id, String(view[id]));
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export interface ViewButtonLink {
  id: keyof ViewState;
  label: string;
  state: ViewMode;
  stateLabel: string;
  /** 押した後の URL（このボタンだけ次の状態へ進め、他のボタンはそのまま）。 */
  href: string;
}

export function viewButtonLinks(view: ViewState, path: string): ViewButtonLink[] {
  return VIEW_BUTTONS.map((button) => ({
    id: button.id,
    label: button.label,
    state: view[button.id],
    stateLabel: button.states[view[button.id]],
    href: path + viewQuery({ ...view, [button.id]: nextMode(view[button.id]) }),
  }));
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** 視界ボタン 3 つの HTML。見た目は Q-005 の page-css.ts にある .view-controls / .view-button.state-N を使う。 */
export function renderViewButtons(view: ViewState, path: string): string {
  const links = viewButtonLinks(view, path)
    .map(
      (b) =>
        `<a class="view-button state-${b.state}" href="${escapeAttr(b.href)}" data-view="${b.id}" data-state="${b.state}"><span>${b.label}</span><strong>${b.stateLabel}</strong></a>`,
    )
    .join("\n");
  return `<nav class="view-controls" aria-label="視界ボタン">\n${links}\n</nav>`;
}

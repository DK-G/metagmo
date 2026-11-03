// D-013 ページの輪郭。ワードクラウドの上に置く、ページ全体の形を見る 1 枚（SVG・JS なし・文字なし）。
// 全体の総票数が多い順に上位 12 ラベルを横線に取り、中心から左へ賛成、右へ反対の長さを取って端をつなぐ。
// 元は水質分析の図（陽イオンを左・陰イオンを右に伸ばし、輪郭で水の型を見分ける）。
// 左右対称＝割れ、片側に寄る＝合意、上だけ太い＝少数に集中。効くかは目視で確かめる（読み取りの実験は無い）。

import type { ViewTag } from "./views";

export const OUTLINE_LABELS = 12;
/** これより少ないラベルでは形にならないので、図を出さない。 */
export const OUTLINE_MIN_LABELS = 3;

export interface OutlineSides {
  /** 賛成の比率（ラベルの賛成票 ÷ その輪郭の 12 ラベルの票の合計）。並びはラベルと同じ。 */
  left: number[];
  /** 反対の比率。 */
  right: number[];
}

/** 全体の総票数が多い順に上位 12 ラベル。票の無いタグは入れない。同数は作成順。 */
export function outlineLabels(allTags: ViewTag[]): ViewTag[] {
  return allTags
    .filter((t) => t.up + t.down > 0)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.up + b.t.down - (a.t.up + a.t.down) || a.i - b.i)
    .slice(0, OUTLINE_LABELS)
    .map(({ t }) => t);
}

/**
 * ラベルの並びのまま、tags の票を比率にする。視界で消えたラベルは 0。
 * 12 ラベルに票が 1 つも無ければ null（輪郭を描かない）。
 */
export function outlineSides(labels: ViewTag[], tags: ViewTag[]): OutlineSides | null {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const rows = labels.map((l) => byId.get(l.id) ?? { up: 0, down: 0 });
  const sum = rows.reduce((s, r) => s + r.up + r.down, 0);
  if (sum === 0) return null;
  return { left: rows.map((r) => r.up / sum), right: rows.map((r) => r.down / sum) };
}

const W = 240;
const CX = W / 2;
const HALF = 110;
const PAD = 8;
const STEP = 16;
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const pts = (ps: Array<[number, number]>) => ps.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");

/**
 * 輪郭の SVG。view が null（視界ボタンが全部未押し）なら全体の輪郭だけを塗って出す。
 * 視界が押されていれば視界の輪郭を塗り、全体の輪郭を薄い線で重ねる。並びは全体の順で固定。
 * 両方の輪郭は同じ物差し（2 つの中の最大の比率が半幅）で描く。ラベルが 3 つ未満なら空文字。
 */
export function renderOutline(allTags: ViewTag[], viewTags: ViewTag[] | null): string {
  const labels = outlineLabels(allTags);
  if (labels.length < OUTLINE_MIN_LABELS) return "";
  const all = outlineSides(labels, allTags)!;
  const view = viewTags === null ? null : outlineSides(labels, viewTags);
  const filled = viewTags === null ? all : view;
  const max = Math.max(...[all, view].flatMap((s) => (s ? [...s.left, ...s.right] : [])));
  const ys = labels.map((_, i) => PAD + i * STEP);
  const y0 = ys[0];
  const yN = ys[ys.length - 1];
  const x = (v: number) => (v / max) * HALF;

  const parts: string[] = [`<line class="outline-axis" x1="${CX}" y1="${y0}" x2="${CX}" y2="${yN}"/>`];
  if (viewTags !== null) {
    const ring: Array<[number, number]> = [
      ...ys.map((y, i): [number, number] => [CX - x(all.left[i]), y]),
      ...ys.map((y, i): [number, number] => [CX + x(all.right[i]), y]).reverse(),
    ];
    parts.unshift(`<polygon class="outline-all" points="${pts(ring)}"/>`);
  }
  if (filled) {
    const left: Array<[number, number]> = [[CX, y0], ...ys.map((y, i): [number, number] => [CX - x(filled.left[i]), y]), [CX, yN]];
    const right: Array<[number, number]> = [[CX, y0], ...ys.map((y, i): [number, number] => [CX + x(filled.right[i]), y]), [CX, yN]];
    parts.push(`<polygon class="outline-up" points="${pts(left)}"/>`, `<polygon class="outline-down" points="${pts(right)}"/>`);
  }
  const label =
    viewTags === null
      ? `ページの輪郭。票の多い上位 ${labels.length} タグの賛成を左、反対を右に伸ばした形`
      : `この視界の輪郭。全体の輪郭を薄い線で重ねています`;
  return `<figure class="page-outline">
<svg viewBox="0 0 ${W} ${yN + PAD}" role="img" aria-label="${label}">
${parts.join("\n")}
</svg>
<figcaption>ページの輪郭: 票の多い順に上から、左が賛成・右が反対の比率。左右対称なら割れ、片側に寄れば合意。${
    viewTags === null ? "" : "薄い線は全体の輪郭です。"
  }</figcaption>
</figure>`;
}

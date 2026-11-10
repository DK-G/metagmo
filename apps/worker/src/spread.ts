// D-014 票の集まり方の帯。輪郭（D-013、outline.ts）の下に置く 1 本（SVG・JS なし・SVG の中に文字なし）。
// 輪郭は上位 12 ラベルの票だけで割るので、13 位以下に流れた票と、票がまだ増えそうかが見えない。それを補う。
// - 帯の全幅 = 票のあるラベルの数 S
// - 濃い部分 = 実質のラベル数 D = 1 ÷ Σ（各ラベルの総票数 ÷ 総票数）²（Simpson 型。標本の大きさが違っても順位がぶれにくい）
// - 出そろい度 C = 1 − 票が 1 つだけのラベルの数 ÷ 総票数（Turing のサンプルカバレッジ）。0.8 未満なら帯の端を点線にする
// 出どころは Contra 調査 2026-11-09（D:\dev\agents\reports\contra-survey\metagmo.md）。
// 注意: 全体と視界で累積の偏りの曲線が交わる時は、帯 1 本では「どちらが偏っているか」を言い切れない。

import type { ViewTag } from "./views";
import { OUTLINE_MIN_LABELS } from "./outline";

/** 出そろい度がこれ未満なら「まだ絵が固まっていない」とする。 */
export const SPREAD_COVERAGE_MIN = 0.8;

export interface Spread {
  /** 票のあるラベルの数。 */
  labels: number;
  /** 実質のラベル数（1 以上 labels 以下）。 */
  effective: number;
  /** 出そろい度（0〜1）。 */
  coverage: number;
  /** 総票数。 */
  votes: number;
}

/** 票の集まり方。票が 1 つも無ければ null。 */
export function voteSpread(tags: ViewTag[]): Spread | null {
  const counts = tags.map((t) => t.up + t.down).filter((v) => v > 0);
  const votes = counts.reduce((s, v) => s + v, 0);
  if (votes === 0) return null;
  const simpson = counts.reduce((s, v) => s + (v / votes) ** 2, 0);
  const singletons = counts.filter((v) => v === 1).length;
  return { labels: counts.length, effective: 1 / simpson, coverage: 1 - singletons / votes, votes };
}

const W = 240;
const H = 14;
const PAD = 4;
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * 帯の SVG。viewTags が null（視界ボタンが全部未押し）なら全体の帯だけを塗る。
 * 視界が押されていれば視界の帯を塗り、全体の帯を薄い枠で重ねる。両方とも同じ物差し（2 つの中の多い方のラベル数が全幅）。
 * 輪郭と同じく、全体で票のあるラベルが 3 つ未満なら空文字。
 */
export function renderSpread(allTags: ViewTag[], viewTags: ViewTag[] | null): string {
  const all = voteSpread(allTags);
  if (!all || all.labels < OUTLINE_MIN_LABELS) return "";
  const view = viewTags === null ? null : voteSpread(viewTags);
  const filled = viewTags === null ? all : view;
  const max = Math.max(all.labels, view?.labels ?? 0);
  const x = (n: number) => PAD + (n / max) * W;
  const y0 = PAD;
  const y1 = PAD + H;

  const parts: string[] = [];
  if (filled) {
    const open = filled.coverage < SPREAD_COVERAGE_MIN;
    parts.push(
      `<rect class="spread-labels" x="${PAD}" y="${y0}" width="${fmt(x(filled.labels) - PAD)}" height="${H}"/>`,
      `<rect class="spread-effective" x="${PAD}" y="${y0}" width="${fmt(x(filled.effective) - PAD)}" height="${H}"/>`,
      `<line class="${open ? "spread-end spread-open" : "spread-end"}" x1="${fmt(x(filled.labels))}" y1="${y0}" x2="${fmt(x(filled.labels))}" y2="${y1}"/>`,
    );
  }
  if (viewTags !== null) {
    parts.push(
      `<rect class="spread-all" x="${PAD}" y="${y0 - 2}" width="${fmt(x(all.labels) - PAD)}" height="${H + 4}"/>`,
      `<line class="spread-all-effective" x1="${fmt(x(all.effective))}" y1="${y0 - 2}" x2="${fmt(x(all.effective))}" y2="${y1 + 2}"/>`,
    );
  }

  const who = viewTags === null ? "" : "この視界: ";
  const body = filled
    ? `${who}票のあるタグ ${filled.labels} 個のうち、実質 ${fmt1(filled.effective)} 個に票が集まっています（濃い部分）。${
        filled.coverage < SPREAD_COVERAGE_MIN ? "1 票だけのタグが多く、まだ絵が固まっていません（点線の端）。" : ""
      }`
    : "この視界には票がありません。";
  const tail = viewTags === null ? "" : "薄い枠は全体です。";
  const label = filled
    ? `票の集まり方。票のあるタグ ${filled.labels} 個、実質 ${fmt1(filled.effective)} 個`
    : "票の集まり方。この視界には票がありません";
  return `<figure class="vote-spread">
<svg viewBox="0 0 ${W + PAD * 2} ${H + PAD * 2}" role="img" aria-label="${label}">
${parts.join("\n")}
</svg>
<figcaption>${body}${tail}</figcaption>
</figure>`;
}

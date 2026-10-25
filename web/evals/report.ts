// Markdown report for an eval run.
import type { PairResult } from "./judge";
import type { Aggregate, Score } from "./score";

export function renderReport(r: { meta: { model: string; judge: string; variants: string[]; hands: string[]; repeat: number; date: string }; aggregates: Aggregate[]; scores: Score[]; pairs: PairResult[] }): string {
  const { meta, aggregates, scores, pairs } = r;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const s = (ms: number) => `${Math.round(ms / 1000)}s`;
  const lines: string[] = [
    `# Hundredfold engine eval`,
    "",
    `${meta.date.slice(0, 16).replace("T", " ")} UTC · builder ${meta.model} · judge ${meta.judge} · ${meta.hands.length} hands × ${meta.variants.length} variants × ${meta.repeat}`,
    "",
    "## Summary",
    "",
    "| Variant | Builds | Legal | Avg time | Max time | Avg cost | Searches | Submits | Template (of 6) | Missing template cards | Color-source gap | Generic staples | Over budget | Too-strong combos | All seeds | Judge W/L/T vs baseline |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const a of aggregates) {
    lines.push(
      `| ${a.variant} | ${a.builds} | ${pct(a.okRate)} | ${s(a.avgMs)} | ${s(a.maxMs)} | ${a.avgCost != null ? `$${a.avgCost.toFixed(3)}` : "?"} | ${a.avgSearches} | ${a.avgSubmits} | ${a.templateHits} | ${a.templateShortfall} | ${a.colorShortfall} | ${pct(a.stapleShare)} | ${a.overBudget} | ${a.strongCombos} | ${pct(a.allSeeds)} | ${a.judgeWins != null ? `${a.judgeWins}/${a.judgeLosses}/${a.judgeTies}` : "baseline"} |`,
    );
  }
  lines.push(
    "",
    "How to read it: higher is better for Legal, Template, All seeds and judge wins; lower is better for time, cost, missing template cards, color-source gap (lands short of the Karsten targets, summed over colors), generic staples (share of top-300 EDHREC cards among non-seed spells), over-budget decks and too-strong combos. Template and mana numbers are counted from Oracle text by `lib/shared/analysis.ts`, not from the builder's own tags.",
  );

  if (pairs.length) {
    const crit = new Set<string>();
    for (const p of pairs) for (const v of Object.values(p.scores ?? {})) for (const k of Object.keys(v)) crit.add(k);
    const keys = [...crit];
    lines.push("", "## Judge scores (average, 1–10)", "", `| Variant | ${keys.join(" | ")} |`, `|---|${keys.map(() => "---").join("|")}|`);
    for (const v of meta.variants) {
      const rows = pairs.flatMap((p) => (p.scores?.[v] ? [p.scores[v]] : []));
      if (!rows.length) continue;
      lines.push(`| ${v} | ${keys.map((k) => (rows.reduce((n, x) => n + (x[k] ?? 0), 0) / rows.length).toFixed(1)).join(" | ")} |`);
    }
    lines.push("", "## Judge verdicts", "");
    for (const p of pairs) {
      const reason = p.verdicts.map((v) => v.reasons).filter(Boolean)[0] ?? "";
      lines.push(`- **${p.hand}**: ${p.a} vs ${p.b} → **${p.winner}**${p.agree ? "" : " (the two orders disagreed)"}. ${reason}`);
    }
  }

  lines.push("", "## Per build", "", "| Hand | Variant | Run | Result | Commander | Time | Cost | Searches | Submits | Template | Color gap | Staples | €  | Combos | Review |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const x of [...scores].sort((a, b) => a.hand.localeCompare(b.hand) || a.variant.localeCompare(b.variant) || a.run - b.run)) {
    lines.push(
      `| ${x.hand} | ${x.variant} | ${x.run} | ${x.ok ? "legal" : `**failed**: ${(x.error ?? "").slice(0, 80)}`} | ${x.commander ?? ""} | ${s(x.ms)} | ${x.costUsd != null ? `$${x.costUsd.toFixed(3)}` : "?"} | ${x.searches} | ${x.submits}${x.revises ? `+${x.revises}r` : ""} | ${x.templateHits}/6 | ${x.colorShortfall} | ${pct(x.stapleShare)} | ${Math.round(x.priceEur)}${x.overBudget ? " (over)" : ""} | ${x.combosChecked ? x.strongCombos : "?"} | ${(x.review ?? "").replace(/\|/g, "/").slice(0, 80)} |`,
    );
  }
  return lines.join("\n") + "\n";
}

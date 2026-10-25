// Scorecard for one eval build, and the aggregate per engine variant. Pure functions.
import type { AgentResult } from "../lib/server/agent";
import type { ComboReport } from "../lib/server/combos";
import type { StreamEvent, Usage } from "../lib/shared/types";
import { simulateOpeners } from "../lib/shared/openers";

export { costUsd } from "../lib/shared/models";
import { costUsd } from "../lib/shared/models";

export interface Hand {
  id: string;
  note?: string;
  seeds: string[];
  commander: string | null;
  budget: "any" | "mid" | "budget";
  theme?: string;
}

export interface Score {
  hand: string;
  variant: string;
  run: number;
  ok: boolean;
  error?: string;
  ms: number;
  calls: number;
  searches: number;
  lookups: number;
  submits: number;
  revises: number;
  usage: Usage;
  costUsd: number | null;
  commander?: string;
  /** template roles (lands, ramp, draw, removal, wipes, protection) inside their range, of 6 */
  templateHits: number;
  /** total cards missing below the template minimums */
  templateShortfall: number;
  colorShortfall: number; // sum over colors of (target - sources) where positive
  stapleShare: number;
  avgMv: number;
  priceEur: number;
  overBudget: boolean;
  gameChangers: number;
  strongCombos: number; // two-card combos rated above Bracket 3 (Commander Spellbook)
  combosChecked: boolean;
  seedsInDeck: number;
  unverifiedTags: number;
  warnings: number;
  review?: string;
  /** Goldfished opening hands: fourth land on turn 4; commander cast by the turn after its MV; worst color by turn 3. */
  landDrop4?: number;
  commanderOnTime?: number;
  worstColorT3?: number;
}

export function scoreBuild(args: {
  hand: Hand;
  variant: string;
  run: number;
  model: string;
  ms: number;
  events: StreamEvent[];
  result: AgentResult | null;
  combos: ComboReport | null;
  error?: string;
}): Score {
  const { hand, variant, run, model, ms, events, result, combos } = args;
  const usageEv = events.filter((e) => e.type === "usage").at(-1) as Extract<StreamEvent, { type: "usage" }> | undefined;
  const usage = usageEv?.usage ?? { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const tools = events.filter((e) => e.type === "tool") as Extract<StreamEvent, { type: "tool" }>[];
  const errorEv = events.find((e) => e.type === "error") as Extract<StreamEvent, { type: "error" }> | undefined;
  const base = {
    hand: hand.id,
    variant,
    run,
    ms,
    calls: usage.calls,
    searches: tools.filter((t) => t.name === "search_cards").length,
    lookups: tools.filter((t) => t.name === "get_cards").length,
    submits: events.filter((e) => e.type === "draft_start").length,
    revises: tools.filter((t) => t.name === "revise_deck").length,
    usage,
    costUsd: costUsd(model, usage),
  };
  if (!result) {
    return {
      ...base, ok: false, error: args.error ?? errorEv?.message ?? "no deck", templateHits: 0, templateShortfall: 0, colorShortfall: 0, stapleShare: 0, avgMv: 0,
      priceEur: 0, overBudget: false, gameChangers: 0, strongCombos: 0, combosChecked: false, seedsInDeck: 0, unverifiedTags: 0, warnings: 0,
    };
  }
  const a = result.analysis;
  let hits = 0;
  let short = 0;
  for (const t of Object.values(a.template)) {
    if (t.have >= t.want[0] && t.have <= t.want[1]) hits++;
    if (t.have < t.want[0]) short += t.want[0] - t.have;
  }
  const seeds = new Set(hand.seeds.map((s) => s.toLowerCase().split(" // ")[0]));
  const all = [result.deck.commander, ...(result.deck.partner ? [result.deck.partner] : []), ...result.deck.cards];
  const seedsInDeck = all.filter((c) => seeds.has(c.name.toLowerCase().split(" // ")[0])).length;
  return {
    ...base,
    ok: result.validation.ok,
    error: result.validation.ok ? undefined : result.validation.errors.join(" | "),
    commander: [result.deck.commander.name, result.deck.partner?.name].filter(Boolean).join(" + "),
    templateHits: hits,
    templateShortfall: short,
    colorShortfall: a.colors.reduce((n, c) => n + Math.max(0, c.target - c.sources), 0),
    stapleShare: a.stapleShare,
    avgMv: a.avgMv,
    priceEur: a.priceEur,
    overBudget: a.budgetCapEur != null && a.priceEur > a.budgetCapEur * 1.15,
    gameChangers: result.validation.gameChangers.length,
    strongCombos: combos?.tooStrong.length ?? 0,
    combosChecked: combos?.checked ?? false,
    seedsInDeck,
    unverifiedTags: a.unverifiedTags.length,
    warnings: result.validation.warnings.length,
    review: result.review,
    ...openerScores(result),
  };
}

function openerScores(result: AgentResult) {
  const o = simulateOpeners(result.deck, { games: 2000 });
  return {
    landDrop4: o.landDrop4,
    commanderOnTime: o.commanders.length ? Math.min(...o.commanders.map((c) => c.oneLate)) : undefined,
    worstColorT3: o.colorByTurn3.length ? Math.min(...o.colorByTurn3.map((c) => c.share)) : undefined,
  };
}

export interface Aggregate {
  variant: string;
  builds: number;
  okRate: number;
  avgMs: number;
  maxMs: number;
  avgCost: number | null;
  avgSearches: number;
  avgSubmits: number;
  templateHits: number;
  templateShortfall: number;
  colorShortfall: number;
  stapleShare: number;
  overBudget: number;
  strongCombos: number;
  allSeeds: number; // share of builds with all five seeds
  landDrop4: number;
  commanderOnTime: number;
  worstColorT3: number;
  judgeWins?: number;
  judgeLosses?: number;
  judgeTies?: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function aggregate(variant: string, scores: Score[]): Aggregate {
  const s = scores.filter((x) => x.variant === variant);
  const ok = s.filter((x) => x.ok);
  const costs = s.map((x) => x.costUsd).filter((x): x is number => x != null);
  return {
    variant,
    builds: s.length,
    okRate: r2(s.length ? ok.length / s.length : 0),
    avgMs: Math.round(avg(s.map((x) => x.ms))),
    maxMs: Math.max(0, ...s.map((x) => x.ms)),
    avgCost: costs.length ? Math.round(avg(costs) * 1000) / 1000 : null,
    avgSearches: r2(avg(s.map((x) => x.searches))),
    avgSubmits: r2(avg(s.map((x) => x.submits))),
    templateHits: r2(avg(ok.map((x) => x.templateHits))),
    templateShortfall: r2(avg(ok.map((x) => x.templateShortfall))),
    colorShortfall: r2(avg(ok.map((x) => x.colorShortfall))),
    stapleShare: r2(avg(ok.map((x) => x.stapleShare))),
    overBudget: ok.filter((x) => x.overBudget).length,
    strongCombos: ok.reduce((n, x) => n + x.strongCombos, 0),
    allSeeds: r2(ok.length ? ok.filter((x) => x.seedsInDeck >= 5).length / ok.length : 0),
    landDrop4: r2(avg(ok.map((x) => x.landDrop4 ?? 0))),
    commanderOnTime: r2(avg(ok.map((x) => x.commanderOnTime ?? 0))),
    worstColorT3: r2(avg(ok.map((x) => x.worstColorT3 ?? 0))),
  };
}

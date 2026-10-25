// Blind pairwise judge: a strong model compares two decks built from the same seeds.
// Each pair is judged twice with the order swapped; a win only counts when both orders agree.
// The judge sees decklists only (no strategy text or "why" notes), so it rates the cards,
// not the writing.
import type { ModelCaller } from "../lib/server/anthropic";
import type { Deck } from "../lib/shared/types";
import { isBasicLand } from "../lib/shared/types";
import type { Hand } from "./score";

export interface Verdict {
  winner: "1" | "2" | "tie";
  scores?: Record<"1" | "2", Record<string, number>>;
  reasons?: string;
}

export interface PairResult {
  hand: string;
  a: string; // variant names
  b: string;
  winner: string | "tie"; // variant name or tie
  agree: boolean;
  verdicts: Verdict[];
  scores?: Record<string, Record<string, number>>; // averaged per variant
}

const TYPES = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"];

export function decklistForJudge(deck: Deck): string {
  const groups = new Map<string, string[]>();
  for (const c of deck.cards) {
    const front = (c.info?.typeLine ?? (isBasicLand(c.name) ? "Land" : "Other")).split("//")[0];
    const type = TYPES.find((t) => new RegExp(`\\b${t}\\b`).test(front)) ?? "Other";
    const line = `${c.qty > 1 ? `${c.qty} ` : ""}${c.name}${c.info?.manaCost ? ` ${c.info.manaCost}` : ""}`;
    groups.set(type, [...(groups.get(type) ?? []), line]);
  }
  const cmd = [deck.commander, deck.partner].filter(Boolean).map((c) => `${c!.name}${c!.info?.manaCost ? ` ${c!.info.manaCost}` : ""}`).join(" + ");
  const out = [`Commander: ${cmd}`];
  for (const t of [...TYPES, "Other"]) {
    const g = groups.get(t);
    if (g?.length) out.push(`${t} (${g.reduce((n, l) => n + (Number(l.match(/^(\d+) /)?.[1]) || 1), 0)}):\n${g.join("\n")}`);
  }
  return out.join("\n\n");
}

const CRITERIA = ["seed_synergy", "function", "mana", "bracket_fit", "fun"] as const;

export function judgePrompt(hand: Hand, first: Deck, second: Deck): string {
  return [
    "You are an expert Commander (EDH) player and deck reviewer. Two decks were built from the same request. Judge which deck better fulfils it.",
    "",
    `REQUEST: a Bracket 3 ("Upgraded") Commander deck built around these five seed cards: ${hand.seeds.join("; ")}.`,
    hand.commander ? `The user chose ${hand.commander} as the commander.` : "The user let the builder choose the commander.",
    `Budget: ${hand.budget === "budget" ? "under about €75" : hand.budget === "mid" ? "about €150–250" : "no limit"}.${hand.theme ? ` Wishes: ${hand.theme}` : ""}`,
    "",
    "Bracket 3: up to three Game Changers, no mass land denial, no chained extra turns, no cheap early two-card combos; games should last about six turns or more.",
    "",
    "Criteria (score each 1–10 for both decks):",
    "- seed_synergy: do the seeds matter? Does the deck have a coherent plan that makes them better, or is it a pile of generic staples?",
    "- function: enough ramp, card draw, interaction, wipes and protection for the plan; sensible curve.",
    "- mana: land count, colored sources for the deck's pips, few tapped lands.",
    "- bracket_fit: fair power for Bracket 3 — neither underpowered nor stronger than the bracket allows.",
    "- fun: would a Bracket 3 player enjoy piloting this and playing against it?",
    "",
    "Ignore card prices unless a deck clearly ignores the budget. Don't reward length of lists or famous cards for their own sake.",
    "",
    "<deck_1>",
    decklistForJudge(first),
    "</deck_1>",
    "",
    "<deck_2>",
    decklistForJudge(second),
    "</deck_2>",
    "",
    'Think it through, then answer with ONLY a JSON object: {"scores":{"1":{"seed_synergy":n,"function":n,"mana":n,"bracket_fit":n,"fun":n},"2":{...}},"winner":"1"|"2"|"tie","reasons":"two or three sentences"}',
  ].join("\n");
}

export function parseVerdict(text: string): Verdict | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const w = String(j.winner ?? "").trim();
    if (!["1", "2", "tie"].includes(w)) return null;
    return { winner: w as Verdict["winner"], scores: j.scores, reasons: typeof j.reasons === "string" ? j.reasons : undefined };
  } catch {
    return null;
  }
}

async function ask(caller: ModelCaller, model: string, prompt: string): Promise<Verdict | null> {
  const msg = await caller({ model, max_tokens: 16000, system: "You are a careful, impartial judge of Magic: The Gathering Commander decks.", messages: [{ role: "user", content: prompt }] }, {});
  const text = msg.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
  return parseVerdict(text);
}

/** Compare variant a's deck with variant b's deck on one hand, in both orders. */
export async function judgePair(caller: ModelCaller, model: string, hand: Hand, a: { variant: string; deck: Deck }, b: { variant: string; deck: Deck }): Promise<PairResult> {
  const [v1, v2] = await Promise.all([ask(caller, model, judgePrompt(hand, a.deck, b.deck)), ask(caller, model, judgePrompt(hand, b.deck, a.deck))]);
  // map each verdict to variant names
  const pick = (v: Verdict | null, firstIsA: boolean) => (!v || v.winner === "tie" ? "tie" : (v.winner === "1") === firstIsA ? a.variant : b.variant);
  const w1 = pick(v1, true);
  const w2 = pick(v2, false);
  const agree = w1 === w2;
  const scores: Record<string, Record<string, number>> = {};
  const add = (variant: string, s?: Record<string, number>) => {
    if (!s) return;
    scores[variant] ??= {};
    for (const k of CRITERIA) if (typeof s[k] === "number") scores[variant][k] = (scores[variant][k] ?? 0) + s[k] / 2;
  };
  add(a.variant, v1?.scores?.["1"]);
  add(b.variant, v1?.scores?.["2"]);
  add(a.variant, v2?.scores?.["2"]);
  add(b.variant, v2?.scores?.["1"]);
  return { hand: hand.id, a: a.variant, b: b.variant, winner: agree ? w1 : "tie", agree, verdicts: [v1, v2].filter((v): v is Verdict => !!v), scores };
}

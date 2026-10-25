// "Deck shape": optional limits the user sets for a build (creatures, lands, ramp, card draw,
// removal, board wipes, average mana value). The server counts them from the card text, the
// same way as the deck analysis, so Claude's own role tags can't fake them.
import type { DeckAnalysis } from "./analysis";
import type { Deck } from "./types";
import { isBasicLand } from "./types";

export const SHAPE_KEYS = ["creatures", "lands", "ramp", "draw", "removal", "wipes"] as const;
export type ShapeKey = (typeof SHAPE_KEYS)[number];
export type Range = { min?: number; max?: number };
export type DeckShape = Partial<Record<ShapeKey, Range>> & { maxAvgMv?: number };

export const SHAPE_LABELS: Record<ShapeKey, string> = {
  creatures: "Creatures",
  lands: "Lands",
  ramp: "Ramp",
  draw: "Card draw",
  removal: "Removal",
  wipes: "Board wipes",
};

/** What a typical Commander deck has, shown as placeholders. */
export const SHAPE_TYPICAL: Record<ShapeKey, string> = {
  creatures: "25–35",
  lands: "35–38",
  ramp: "9–12",
  draw: "9–12",
  removal: "8–12",
  wipes: "2–4",
};

const int = (v: unknown) => {
  if (v === "" || v == null) return undefined;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 99 ? n : undefined;
};

/** A clean shape from a request, or a message saying what's wrong. Empty → undefined. */
export function cleanShape(raw: unknown): DeckShape | undefined | string {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, any>;
  const out: DeckShape = {};
  for (const k of SHAPE_KEYS) {
    const min = int(r[k]?.min);
    const max = int(r[k]?.max);
    if (min == null && max == null) continue;
    if (min != null && max != null && min > max) return `${SHAPE_LABELS[k]}: the minimum (${min}) is above the maximum (${max}).`;
    out[k] = { ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
  }
  const avg = Number(r.maxAvgMv);
  if (r.maxAvgMv !== "" && r.maxAvgMv != null && Number.isFinite(avg)) {
    if (avg < 1.5 || avg > 6) return "Average mana value: pick a maximum between 1.5 and 6.";
    out.maxAvgMv = Math.round(avg * 10) / 10;
  }
  if ((out.lands?.min ?? 0) + (out.creatures?.min ?? 0) > 99) return "Lands and creatures together can't be more than the 99 cards besides the commander.";
  if (out.lands?.max != null && out.lands.max < 25) return "Fewer than 25 lands doesn't make a working Commander deck. Pick a higher maximum.";
  return Object.keys(out).length ? out : undefined;
}

/** The numbers the limits are checked against (card text, not Claude's tags). */
export function shapeCounts(deck: Deck, a: DeckAnalysis): Record<ShapeKey, number> & { avgMv: number } {
  const creatures = deck.cards.reduce((n, c) => n + (c.info && !isBasicLand(c.name) && /\bCreature\b/.test(c.info.typeLine.split("//")[0]) && !/\bLand\b/.test(c.info.typeLine.split("//")[0]) ? c.qty : 0), 0);
  return { creatures, lands: a.lands, ramp: a.counts.ramp, draw: a.counts.draw, removal: a.counts.removal, wipes: a.counts.wipe, avgMv: a.avgMv };
}

const rangeText = (r: Range) => (r.min != null && r.max != null ? (r.min === r.max ? `exactly ${r.min}` : `${r.min}–${r.max}`) : r.min != null ? `at least ${r.min}` : `at most ${r.max}`);

/** For the prompt. */
export function shapeText(shape?: DeckShape): string {
  if (!shape) return "";
  const parts = SHAPE_KEYS.filter((k) => shape[k]).map((k) => `${SHAPE_LABELS[k].toLowerCase()} ${rangeText(shape[k]!)}`);
  if (shape.maxAvgMv != null) parts.push(`average mana value of the nonland cards at most ${shape.maxAvgMv}`);
  if (!parts.length) return "";
  return `DECK SHAPE (the user's limits; they replace the template for these counts): ${parts.join("; ")}. The server counts creatures from the type line and ramp, draw, removal and wipes from the card text, and sends the deck back if a count is outside a limit. A card can count for several (a creature that draws a card is both).`;
}

export interface ShapeCheck {
  key: ShapeKey | "avgMv";
  label: string;
  want: string;
  have: number;
  ok: boolean;
}

export function checkShape(shape: DeckShape | undefined, counts: ReturnType<typeof shapeCounts>): ShapeCheck[] {
  if (!shape) return [];
  const out: ShapeCheck[] = [];
  for (const k of SHAPE_KEYS) {
    const r = shape[k];
    if (!r) continue;
    const have = counts[k];
    out.push({ key: k, label: SHAPE_LABELS[k], want: rangeText(r), have, ok: (r.min == null || have >= r.min) && (r.max == null || have <= r.max) });
  }
  if (shape.maxAvgMv != null) out.push({ key: "avgMv", label: "Average mana value", want: `at most ${shape.maxAvgMv}`, have: Math.round(counts.avgMv * 100) / 100, ok: counts.avgMv <= shape.maxAvgMv + 1e-9 });
  return out;
}

/** Messages for Claude when the deck is outside a limit. */
export function shapeProblems(shape: DeckShape | undefined, counts: ReturnType<typeof shapeCounts>): string[] {
  return checkShape(shape, counts)
    .filter((c) => !c.ok)
    .map((c) => {
      if (c.key === "avgMv") return `The average mana value is ${c.have}; the user wants ${c.want}. Swap expensive cards for cheaper ones.`;
      const r = shape![c.key]!;
      const fix = r.min != null && c.have < r.min ? `add ${r.min - c.have}` : `cut ${c.have - r.max!}`;
      return `${c.label}: the deck has ${c.have}; the user wants ${c.want}. ${fix[0].toUpperCase()}${fix.slice(1)} (counted from the card text).`;
    });
}

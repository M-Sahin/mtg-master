// Pure helpers for deck stats and export (used by the UI and tests).
import type { Color, Deck, DeckCard, Role } from "./types";
import { ROLES, isBasicLand } from "./types";

export const ROLE_COLORS: Record<Role, string> = {
  ramp: "#49b57a",
  draw: "#5aa9e6",
  removal: "#ef6a4c",
  wipe: "#f29b38",
  protection: "#f3e6c0",
  recursion: "#b08ce0",
  synergy: "#e2b04a",
  wincon: "#ec5f9c",
  land: "#8d7a5c",
  utility: "#8c93bd",
};

export const MANA_COLORS: Record<Color | "C", string> = {
  W: "#f3e6c0",
  U: "#5aa9e6",
  B: "#b4a7d6",
  R: "#ef6a4c",
  G: "#49b57a",
  C: "#b9bcc9",
};

export function isLand(c: DeckCard): boolean {
  return isBasicLand(c.name) || /\bLand\b/.test((c.info?.typeLine ?? "").split("//")[0]);
}

export function totalCards(deck: Deck): number {
  return 1 + (deck.partner ? 1 : 0) + deck.cards.reduce((n, c) => n + c.qty, 0);
}

export function byRole(deck: Deck): { role: Role; cards: DeckCard[]; count: number }[] {
  return ROLES.map((role) => {
    const cards = deck.cards.filter((c) => c.role === role).sort((a, b) => (a.info?.cmc ?? 0) - (b.info?.cmc ?? 0) || a.name.localeCompare(b.name));
    return { role, cards, count: cards.reduce((n, c) => n + c.qty, 0) };
  }).filter((g) => g.count > 0);
}

const TYPE_ORDER = ["Creature", "Planeswalker", "Instant", "Sorcery", "Artifact", "Enchantment", "Battle", "Land"];
export function primaryType(c: DeckCard): string {
  const front = (c.info?.typeLine ?? (isBasicLand(c.name) ? "Land" : "")).split("//")[0];
  if (/\bLand\b/.test(front)) return "Land";
  return TYPE_ORDER.find((t) => front.includes(t)) ?? "Other";
}

export function byType(deck: Deck) {
  const groups = new Map<string, DeckCard[]>();
  for (const c of deck.cards) {
    const t = primaryType(c);
    groups.set(t, [...(groups.get(t) ?? []), c]);
  }
  return [...TYPE_ORDER, "Other"]
    .filter((t) => groups.has(t))
    .map((t) => ({ type: t, cards: groups.get(t)!.sort((a, b) => (a.info?.cmc ?? 0) - (b.info?.cmc ?? 0) || a.name.localeCompare(b.name)), count: groups.get(t)!.reduce((n, c) => n + c.qty, 0) }));
}

/** Mana curve of nonland cards: index 0..6, 7 = 7+. */
export function curve(deck: Deck): number[] {
  const out = new Array(8).fill(0);
  for (const c of deck.cards) {
    if (isLand(c)) continue;
    out[Math.min(Math.floor(c.info?.cmc ?? 0), 7)] += c.qty;
  }
  return out;
}

export function averageMv(deck: Deck): number {
  let n = 0;
  let s = 0;
  for (const c of deck.cards) {
    if (isLand(c)) continue;
    n += c.qty;
    s += (c.info?.cmc ?? 0) * c.qty;
  }
  return n ? s / n : 0;
}

/** Count colored pips in mana costs of the 99 + commander. */
export function pips(deck: Deck): Record<Color, number> {
  const out: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of [deck.commander, ...deck.cards]) {
    const cost = c.info?.manaCost ?? "";
    for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
      for (const col of ["W", "U", "B", "R", "G"] as Color[]) if (m[1].split("/").includes(col)) out[col] += c.qty;
    }
  }
  return out;
}

export function price(deck: Deck): { eur: number; missing: number } {
  let eur = 0;
  let missing = 0;
  for (const c of [deck.commander, ...(deck.partner ? [deck.partner] : []), ...deck.cards]) {
    if (isBasicLand(c.name)) continue;
    const p = c.info?.priceEur ?? null;
    if (p == null) missing++;
    else eur += p * c.qty;
  }
  return { eur, missing };
}

/** Moxfield / Archidekt / Arena-compatible text. */
export function exportText(deck: Deck, style: "moxfield" | "arena" = "moxfield"): string {
  const lines: string[] = [];
  if (style === "arena") lines.push("Commander");
  lines.push(`1 ${deck.commander.name}`);
  if (deck.partner) lines.push(`1 ${deck.partner.name}`);
  lines.push("");
  if (style === "arena") lines.push("Deck");
  const sorted = [...deck.cards].sort((a, b) => Number(isLand(a)) - Number(isLand(b)) || a.name.localeCompare(b.name));
  for (const c of sorted) lines.push(`${c.qty} ${c.name}`);
  return lines.join("\n") + "\n";
}

/** Expand the 99 into individual cards (basics repeated) for sample hands. */
export function library(deck: Deck): DeckCard[] {
  return deck.cards.flatMap((c) => Array.from({ length: c.qty }, () => c));
}

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function parseManaCost(cost: string): string[] {
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/** The seeds a deck was built from (commander first), when all five are known. */
export function deckSeeds(deck: Deck): string[] | null {
  const seeds = [...(deck.commander.seed ? [deck.commander.name] : []), ...deck.cards.filter((c) => c.seed).map((c) => c.name)];
  return seeds.length === 5 ? seeds : null;
}

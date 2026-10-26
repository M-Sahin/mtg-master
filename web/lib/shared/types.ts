// Types shared by the server (route handlers) and the client UI.
import type { DeckShape } from "./shape";
import type { DeckAnalysis } from "./analysis";

export type Color = "W" | "U" | "B" | "R" | "G";

/** Compact card data used everywhere in the app (subset of a Scryfall card object). */
export interface CardInfo {
  name: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  oracleText: string;
  colorIdentity: Color[];
  legalCommander: "legal" | "not_legal" | "banned" | "restricted";
  canBeCommander: boolean;
  gameChanger: boolean;
  priceEur: number | null;
  priceUsd: number | null;
  image: string | null; // normal-size card image
  artCrop: string | null;
  artist: string | null;
  scryfallUri: string;
  edhrecRank: number | null;
  producedMana?: string[]; // Scryfall produced_mana (W U B R G C)
  layout?: string; // Scryfall layout: normal, transform, modal_dfc, split, adventure…
}

export const ROLES = [
  "ramp",
  "draw",
  "removal",
  "wipe",
  "protection",
  "recursion",
  "synergy",
  "wincon",
  "land",
  "utility",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ramp: "Ramp",
  draw: "Card draw",
  removal: "Removal",
  wipe: "Board wipes",
  protection: "Protection",
  recursion: "Recursion",
  synergy: "Synergy",
  wincon: "Win conditions",
  land: "Lands",
  utility: "Utility",
};

export interface DeckCard {
  name: string;
  role: Role;
  why: string;
  qty: number; // >1 only for basic lands
  seed?: boolean;
  info?: CardInfo;
}

export interface Deck {
  name: string;
  commander: DeckCard;
  partner?: DeckCard;
  cards: DeckCard[]; // the 99 (or 98 with a partner), basics merged in with qty
  strategy: string;
  winConditions: string[];
  bracketNotes: string;
  colorIdentity: Color[];
  /** The bracket the deck was built for (missing = 3). */
  bracket?: number;
  /** The user's deck-shape limits, when they set any. */
  shape?: DeckShape;
}

export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  total: number;
  gameChangers: string[];
}

export type Budget = "any" | "mid" | "budget";

/** Token usage of one build, summed over all model calls. */
export interface Usage {
  calls: number;
  input: number; // uncached input tokens
  cacheRead: number;
  cacheWrite: number;
  output: number; // includes thinking tokens
}

export interface GenerateRequest {
  /**
   * "seeds" (default): build around five seed cards. "complete": finish a deck the user started.
   * "upgrade": suggest up to 10 swaps for a finished deck.
   */
  mode?: "seeds" | "complete" | "upgrade";
  seeds: string[]; // seeds mode: exactly 5 card names; complete/upgrade mode: the nonbasic cards in the user's deck
  commander: string | null; // seeds mode: one of the seeds, or null = let Claude choose; complete/upgrade mode: required
  partner?: string | null; // complete/upgrade mode: a second commander the user already has
  /** complete/upgrade mode: basic lands already in the user's deck */
  basics?: Record<string, number>;
  /** Commander bracket to build for (default 3). */
  bracket?: 1 | 2 | 3 | 4;
  budget: Budget;
  theme?: string;
  /** Cards the user owns: "prefer" them, or build "only" from them (plus basics and the seeds). */
  collection?: { names: string[]; mode: "prefer" | "only" };
  /** Optional limits: creatures, lands, ramp, draw, removal, wipes, average mana value. */
  shape?: DeckShape;
}

export const MAX_COLLECTION = 5000;

/** Card name key for comparing collections with deck lists: front face, no accents, lower case. */
export function nameKey(name: string): string {
  return name.split(/\s+\/\/?\s+/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** One suggested change: cut a card, add another (the review round and upgrade mode). */
export interface Swap {
  out: string;
  in: string;
  role?: string;
  why?: string;
}

/** Events streamed from /api/generate as newline-delimited JSON. */
export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string }
  | { type: "tool_result"; id: string; summary: string; ok: boolean }
  | { type: "draft_start"; attempt: number }
  | { type: "draft_card"; name: string; role: Role }
  | { type: "draft_meta"; commander?: string; deckName?: string }
  | { type: "validation"; validation: Validation; attempt: number }
  | { type: "deck"; deck: Deck; validation: Validation; analysis?: DeckAnalysis; review?: string; swaps?: Swap[] }
  | { type: "usage"; usage: Usage; model?: string }
  | { type: "job"; id: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; ms: number };

export const BASIC_LANDS = ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"] as const;
export const BASIC_FOR_COLOR: Record<Color, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

export function isBasicLand(name: string): boolean {
  const n = name.toLowerCase().replace(/^snow-covered /, "");
  return BASIC_LANDS.some((b) => b.toLowerCase() === n);
}

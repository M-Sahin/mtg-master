// Types shared by the server (route handlers) and the client UI.
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
  seeds: string[]; // exactly 5 card names
  commander: string | null; // one of the seeds, or null = let Claude choose
  budget: Budget;
  theme?: string;
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
  | { type: "deck"; deck: Deck; validation: Validation; analysis?: DeckAnalysis; review?: string }
  | { type: "usage"; usage: Usage }
  | { type: "error"; message: string }
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

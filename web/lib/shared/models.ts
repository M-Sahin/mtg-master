// Claude models offered in the model picker, with prices for the cost estimate.
// Prices: USD per million tokens, from platform.claude.com model pages (checked 2026-10-25).
// Per-deck costs in the hints are from the eval (engine v2, 2026-10-25): Sonnet $0.25, Haiku $0.017.
// Models the key can use but that aren't listed here still work; they just show no estimate.
import type { Usage } from "./types";

export interface ModelInfo {
  id: string;
  label: string;
  hint: string;
  recommended?: boolean;
  price?: { input: number; output: number; cacheWrite: number; cacheRead: number };
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export const MODELS: ModelInfo[] = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Recommended: strong decks for about $0.25 each", recommended: true, price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 } },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Strongest decks, slower, about twice the cost of Sonnet", recommended: true, price: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "About 2 cents a deck: legal, simpler decks with weaker mana", recommended: true, price: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 } },
];

export const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{2,60}$/;

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Estimated cost in USD, or null when the model's price isn't known here. */
export function costUsd(model: string, u: Usage): number | null {
  const p = modelInfo(model)?.price;
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) / 1e6;
}

export function formatCost(usd: number | null): string {
  if (usd == null) return "cost unknown for this model";
  if (usd < 0.01) return "under $0.01";
  return `about $${usd.toFixed(2)}`;
}

export function formatTokens(u: Usage): string {
  const total = u.input + u.cacheRead + u.cacheWrite + u.output;
  return total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M tokens` : `${Math.round(total / 1000)}k tokens`;
}

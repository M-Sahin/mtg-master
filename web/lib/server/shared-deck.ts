// Rebuild a full Deck (with Scryfall data and the deck check) from a share-link payload.
import * as scry from "./scryfall";
import { buildDeck, namesInSubmission, validateDeck, type SubmittedDeck } from "./validate";
import type { Deck, Validation } from "../shared/types";
import { ROLES, isBasicLand } from "../shared/types";
import type { SharedPayload } from "../shared/share";

export function payloadToSubmission(p: SharedPayload): { sub: SubmittedDeck; seeds: string[] } {
  const cards: SubmittedDeck["cards"] = [];
  const basics: Record<string, number> = {};
  for (const [name, role, qty = 1] of p.k) {
    if (isBasicLand(name)) basics[name] = (basics[name] ?? 0) + qty;
    else for (let i = 0; i < Math.min(qty, 99); i++) cards.push({ name, role: ROLES[role] ?? "utility", why: "" });
  }
  const seeds = [...(p.e ?? []).map((i) => p.k[i]?.[0]).filter(Boolean), ...(p.cs ? [p.c] : [])] as string[];
  return {
    sub: { deck_name: p.n, commander: p.c, partner: p.p ?? null, strategy: p.s, win_conditions: p.w, bracket_notes: p.b, cards, basics },
    seeds,
  };
}

export async function resolveShared(p: SharedPayload): Promise<{ deck: Deck; validation: Validation }> {
  const { sub, seeds } = payloadToSubmission(p);
  const { found, notFound } = await scry.getCollection(namesInSubmission(sub));
  const deck = buildDeck(sub, found, seeds);
  if (p.br) deck.bracket = p.br;
  return { deck, validation: validateDeck(deck, notFound, seeds, { bracket: p.br ?? 3 }) };
}

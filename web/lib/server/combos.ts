// Two-card combo check via Commander Spellbook (commanderspellbook.com), the community combo
// database that Moxfield, Archidekt and EDHREC also link to. Best effort: if the service is
// slow or down, the build continues without the check.
import type { Deck } from "../shared/types";
import { isBasicLand } from "../shared/types";

const API = "https://backend.commanderspellbook.com/find-my-combos";

export interface Combo {
  id: string;
  cards: string[];
  results: string[];
  /** Commander Spellbook's per-combo bracket rating, e.g. "R" (Ruthless), "S" (Spicy), "P" (Powerful). */
  bracketTag: string | null;
  url: string;
}

export interface ComboReport {
  checked: boolean;
  error?: string;
  combos: Combo[];
  /** Two-card combos rated for higher brackets: not expected at a Bracket 3 table. */
  tooStrong: Combo[];
  /** Strong but slower combos: fine for Bracket 3, worth telling the user about. */
  flagged?: Combo[];
}

/**
 * Commander Spellbook rates each combo: Ruthless = fast two-card combos (above Bracket 3),
 * Spicy = powerful but slower or needing more pieces (allowed, flagged), Powerful, Core, Oddball,
 * Exhibition. Only Ruthless two-card combos are rejected.
 */
export const TOO_STRONG_TAGS = new Set(["R"]);
export const FLAG_TAGS = new Set(["S"]);
export const TAG_NAMES: Record<string, string> = { R: "Ruthless", S: "Spicy", P: "Powerful", O: "Oddball", C: "Core", E: "Exhibition", B: "Banned" };

const cache = new Map<string, ComboReport>();
/** For tests. */
export function resetComboCache() {
  cache.clear();
}

function names(list: any[]): string[] {
  return (list ?? []).map((u: any) => u?.card?.name ?? u?.name ?? "").filter(Boolean);
}

export function parseCombos(body: any): Combo[] {
  const included: any[] = body?.results?.included ?? body?.included ?? [];
  return included.map((v: any) => {
    const id = String(v.id ?? "");
    const tag = v.bracketTag ?? v.bracket_tag ?? null;
    return {
      id,
      cards: names(v.uses),
      results: (v.produces ?? []).map((p: any) => p?.feature?.name ?? p?.name ?? "").filter(Boolean),
      bracketTag: typeof tag === "string" ? tag.toUpperCase() : null,
      url: id ? `https://commanderspellbook.com/combo/${encodeURIComponent(id)}/` : "https://commanderspellbook.com/",
    };
  });
}

export async function checkCombos(deck: Deck, fetchImpl: typeof fetch = fetch): Promise<ComboReport> {
  const commanders = [deck.commander, deck.partner].filter(Boolean).map((c) => ({ card: c!.name }));
  const main = deck.cards.filter((c) => !isBasicLand(c.name)).map((c) => ({ card: c.name, quantity: c.qty }));
  const key = [...commanders.map((c) => c.card), "|", ...main.map((c) => c.card).sort()].join("\n");
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetchImpl(API, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": "hundredfold-mtg-master/1.0 (+https://github.com/M-Sahin/mtg-master)" },
      body: JSON.stringify({ commanders, main }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { checked: false, error: `Commander Spellbook returned HTTP ${res.status}`, combos: [], tooStrong: [] };
    const combos = parseCombos(await res.json());
    const report: ComboReport = {
      checked: true,
      combos,
      tooStrong: combos.filter((c) => c.cards.length <= 2 && c.bracketTag != null && TOO_STRONG_TAGS.has(c.bracketTag)),
      flagged: combos.filter((c) => c.bracketTag != null && FLAG_TAGS.has(c.bracketTag)),
    };
    cache.set(key, report);
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return report;
  } catch (e) {
    return { checked: false, error: `Combo check unavailable: ${(e as Error).message}`, combos: [], tooStrong: [] };
  }
}

export function comboErrors(r: ComboReport): string[] {
  return r.tooStrong.map(
    (c) => `${c.cards.join(" + ")} is a two-card combo (${c.results.slice(0, 2).join(", ") || "infinite"}) that Commander Spellbook rates ${TAG_NAMES[c.bracketTag!] ?? c.bracketTag}: too strong for Bracket 3. Cut one of the pieces (keep any seed).`,
  );
}

export function comboNotes(r: ComboReport): string {
  if (!r.checked) return r.error ?? "Combo check unavailable.";
  if (!r.combos.length) return "Commander Spellbook finds no combos in the deck.";
  return `Combos Commander Spellbook finds in the deck: ${r.combos.slice(0, 8).map((c) => `${c.cards.join(" + ")} → ${c.results.slice(0, 2).join(", ")}${c.bracketTag ? ` [${TAG_NAMES[c.bracketTag] ?? c.bracketTag}]` : ""}`).join("; ")}.`;
}

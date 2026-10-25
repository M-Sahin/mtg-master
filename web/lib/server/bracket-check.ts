// Free bracket checker: paste any Commander decklist, get the lowest bracket it fits and why.
// No Claude involved: Scryfall (Game Changer flags, card text), Commander Spellbook (combos) and
// the same deck check and analysis the builder uses.
//
// Criteria (Wizards' Commander Brackets, checked 2026-10-25):
// - Game Changers: none in brackets 1–2, up to three in 3, any number in 4–5
//   (magic.wizards.com/en/formats/commander)
// - mass land denial: not in 1–3; extra turns: none in 1, few and never chained in 2–3;
//   two-card infinite combos: none intended in 1–2, none early in 3 (Feb 2025 brackets)
// - tutors: no limit since the October 2025 update (the efficient ones are Game Changers)
// - expected game length: 9+ turns (1), 8+ (2), 6+ (3), 4+ (4), any (5) (October 2025 update)
// Brackets 1 and 5 are about intent and can't be told from a list alone.
import { checkCombos, type Combo } from "./combos";
import * as scry from "./scryfall";
import { EXTRA_TURN, MLD, pairingProblem, validateDeck } from "./validate";
import { analyzeDeck, type DeckAnalysis } from "../shared/analysis";
import { simulateOpeners, type OpenerReport } from "../shared/openers";
import { parseDecklist } from "../shared/decklist";
import type { CardInfo, Color, Deck, DeckCard } from "../shared/types";
import { isBasicLand } from "../shared/types";

export const BRACKET_NAMES: Record<number, string> = { 1: "Exhibition", 2: "Core", 3: "Upgraded", 4: "Optimized", 5: "cEDH" };
export const TURNS: Record<number, string> = { 1: "about nine turns or more", 2: "about eight turns or more", 3: "about six turns or more", 4: "about four turns or more", 5: "any turn" };

export interface Reason {
  bracket: number; // the lowest bracket this finding allows
  text: string;
  cards?: string[];
}

export interface BracketReport {
  bracket: number;
  name: string;
  turns: string;
  reasons: Reason[];
  gameChangers: string[];
  massLandDenial: string[];
  extraTurns: string[];
  combos: { checked: boolean; early: Combo[]; other: Combo[] };
  commanders: string[];
  commanderGuessed: boolean;
  total: number;
  /** The cards besides the commander(s), with Scryfall's names (used to complete a deck). */
  cards: { name: string; qty: number }[];
  notFound: string[];
  problems: string[]; // legality / deck-size issues
  analysis: DeckAnalysis | null;
  /** Goldfished opening hands, for decks of 90+ cards. */
  openers: OpenerReport | null;
}

/** The bracket rules as a pure function of what the deck contains. */
export function estimateBracket(f: { gameChangers: string[]; massLandDenial: string[]; extraTurns: string[]; earlyCombos: Combo[]; otherCombos: Combo[] }): { bracket: number; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const gc = f.gameChangers.length;
  if (gc >= 4) reasons.push({ bracket: 4, text: `${gc} Game Changers: bracket 3 allows at most three.`, cards: f.gameChangers });
  else if (gc >= 1) reasons.push({ bracket: 3, text: `${gc} Game Changer${gc > 1 ? "s" : ""}: brackets 1 and 2 allow none, bracket 3 up to three.`, cards: f.gameChangers });
  if (f.massLandDenial.length) reasons.push({ bracket: 4, text: "Mass land denial isn't expected below bracket 4.", cards: f.massLandDenial });
  if (f.extraTurns.length >= 3) reasons.push({ bracket: 4, text: `${f.extraTurns.length} extra-turn cards: brackets 2 and 3 expect only a few, never chained.`, cards: f.extraTurns });
  else if (f.extraTurns.length) reasons.push({ bracket: 2, text: "Extra-turn cards: fine in brackets 2 and 3 as long as they aren't chained; bracket 1 has none.", cards: f.extraTurns });
  for (const c of f.earlyCombos) reasons.push({ bracket: 4, text: `Early two-card combo (${c.results.slice(0, 2).join(", ") || "infinite"}), rated Ruthless by Commander Spellbook: not expected below bracket 4.`, cards: c.cards });
  for (const c of f.otherCombos) reasons.push({ bracket: 3, text: `Two-card combo (${c.results.slice(0, 2).join(", ") || "infinite"}): brackets 1 and 2 expect none; fine in 3 if it doesn't come together early.`, cards: c.cards });
  const bracket = Math.max(2, ...reasons.map((r) => r.bracket));
  reasons.sort((a, b) => b.bracket - a.bracket);
  return { bracket, reasons };
}

function identityOf(cards: CardInfo[]): Set<Color> {
  return new Set(cards.flatMap((c) => c.colorIdentity));
}

export async function checkBracket(text: string): Promise<BracketReport> {
  const parsed = parseDecklist(text);
  const names = [...new Set([...parsed.commanders, ...parsed.commanderGuess, ...parsed.cards.map((c) => c.name)])].slice(0, 260);
  if (!names.length) throw new Error("Paste a decklist: one card per line, like \"1 Sol Ring\".");
  const { found, notFound } = await scry.getCollection(names);
  const info = (n: string) => found.get(n.toLowerCase());

  // who leads the deck: stated, a set-apart first/last block, or the only legal fit
  let cmdNames = parsed.commanders.filter((n) => info(n));
  let guessed = false;
  const cards = parsed.cards.filter((c) => !cmdNames.some((n) => n.toLowerCase() === c.name.toLowerCase()));
  if (!cmdNames.length) {
    const g = parsed.commanderGuess.map((n) => info(n)).filter((c): c is CardInfo => !!c?.canBeCommander);
    if (g.length && g.length === parsed.commanderGuess.length && (g.length === 1 || !pairingProblem(g[0], g[1]))) cmdNames = g.map((c) => c.name);
    else {
      const all = cards.map((c) => info(c.name)).filter((c): c is CardInfo => !!c);
      const fits = all.filter((c) => c.canBeCommander && [...identityOf(all)].every((x) => c.colorIdentity.includes(x)));
      if (fits.length === 1) cmdNames = [fits[0].name];
    }
    guessed = cmdNames.length > 0;
  }
  const isCmd = (n: string) => cmdNames.some((x) => x.toLowerCase() === n.toLowerCase() || info(x)?.name.toLowerCase() === n.toLowerCase());
  const deckCards: DeckCard[] = parsed.cards
    .filter((c) => !isCmd(c.name) || !cmdNames.length)
    .map((c) => ({ name: info(c.name)?.name ?? c.name, qty: c.qty, role: isBasicLand(c.name) ? "land" : "utility", why: "", info: info(c.name) }));
  const cmdCards: DeckCard[] = cmdNames.map((n) => ({ name: info(n)?.name ?? n, qty: 1, role: "wincon", why: "Commander", info: info(n) }));
  const identity = cmdCards.length ? identityOf(cmdCards.map((c) => c.info!).filter(Boolean)) : identityOf(deckCards.map((c) => c.info).filter((c): c is CardInfo => !!c));
  const deck: Deck = {
    name: "Checked deck",
    commander: cmdCards[0] ?? { name: "(no commander found)", qty: 0, role: "wincon", why: "" },
    partner: cmdCards[1],
    cards: deckCards,
    strategy: "",
    winConditions: [],
    bracketNotes: "",
    colorIdentity: (["W", "U", "B", "R", "G"] as Color[]).filter((c) => identity.has(c)),
  };
  const everything = [...cmdCards, ...deckCards];
  const total = everything.reduce((n, c) => n + c.qty, 0);
  const named = (pred: (c: CardInfo) => boolean) => [...new Set(everything.filter((c) => c.info && pred(c.info)).map((c) => c.name))];

  const gameChangers = named((c) => c.gameChanger);
  const massLandDenial = named((c) => MLD.some((r) => r.test(c.oracleText)));
  const extraTurns = named((c) => EXTRA_TURN.test(c.oracleText));
  const combos = total >= 20 ? await checkCombos(deck) : { checked: false, combos: [], tooStrong: [] };
  const twoCard = combos.combos.filter((c) => c.cards.length <= 2);
  const early = twoCard.filter((c) => c.bracketTag === "R");
  const other = twoCard.filter((c) => c.bracketTag !== "R");
  const { bracket, reasons } = estimateBracket({ gameChangers, massLandDenial, extraTurns, earlyCombos: early, otherCombos: other });

  // legality, without the bracket-3 Game Changer cap (that's what we're measuring)
  const problems: string[] = [];
  if (cmdCards.length) {
    const v = validateDeck(deck, notFound, []);
    problems.push(...v.errors.filter((e) => !/Game Changers/.test(e) && !/was not found on Scryfall/.test(e)));
  } else problems.push("No commander found. Put it under a \"Commander\" heading (or first, set apart by an empty line) to check legality and color identity.");
  return {
    bracket,
    name: BRACKET_NAMES[bracket],
    turns: TURNS[bracket],
    reasons,
    gameChangers,
    massLandDenial,
    extraTurns,
    combos: { checked: combos.checked, early, other },
    commanders: cmdCards.map((c) => c.name),
    commanderGuessed: guessed,
    total,
    cards: deckCards.filter((c) => c.info).map((c) => ({ name: c.name, qty: c.qty })),
    notFound,
    problems,
    analysis: cmdCards.length && total >= 60 ? analyzeDeck(deck) : null,
    openers: cmdCards.length && total >= 90 ? simulateOpeners(deck, { games: 3000 }) : null,
  };
}

const hits = new Map<string, number[]>();
export async function handleBracketCheck(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > 60_000) return Response.json({ error: "That list is too long." }, { status: 413 });
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 40) return Response.json({ error: "You've checked a lot of decks this hour. Try again in a bit." }, { status: 429 });
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.list === "string" ? body.list.slice(0, 50_000) : "";
  try {
    return Response.json(await checkBracket(text));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

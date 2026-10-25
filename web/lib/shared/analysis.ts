// Objective deck analysis, independent of the roles Claude assigns to its own cards.
// Used for the stricter deck check, the review pass, the eval scorecard and (later) the UI.
// Everything here is a heuristic over Scryfall's Oracle text and fields: good at counting,
// not a substitute for judgement. Pure functions, no network.
import { COMMANDER_TEMPLATE } from "./bracket";
import type { Budget, CardInfo, Color, Deck, DeckCard } from "./types";
import { isBasicLand } from "./types";

export const FUNCTIONS = ["ramp", "draw", "removal", "wipe", "protection", "recursion", "tutor"] as const;
export type Fn = (typeof FUNCTIONS)[number];

const N = "(?:a|an|one|two|three|four|five|x|that many|up to (?:one|two|three|four|x)|\\d+)";
const BASIC_TYPES = "(?:basic land|land|forest|plains|island|swamp|mountain)";

const RX: Record<Fn, RegExp[]> = {
  ramp: [
    /\{t\}(?:, [^:]*)?: add\b/i, // mana rocks and dorks (only counted on nonland permanents)
    new RegExp(`search your library for ${N}? ?${BASIC_TYPES}[^.]*?(?:cards?)?[^.]*?(?:onto|into) the battlefield`, "i"),
    new RegExp(`search your library for [^.]*${BASIC_TYPES} cards?[^.]*put (?:it|them|one|those cards) onto the battlefield`, "i"),
    /put (?:a|up to \w+) land cards? from your hand onto the battlefield/i,
    /you may play (?:an|two) additional lands?/i,
    /create (?:a|an|two|three|x|\w+) treasure tokens?/i,
    /\badd (?:one mana of any color|\{[wubrgc]\}\{[wubrgc]\}|\w+ mana)[^.]*for each/i, // big mana (Cabal Coffers, Gaea's Cradle style)
  ],
  draw: [
    new RegExp(`\\bdraws? ${N} (?:additional )?cards?`, "i"),
    /\bdraw cards? equal to/i,
    /exile the top (?:\w+ )?cards? of your library[^.]*\. (?:until|you may (?:play|cast))/i, // impulse draw
    /investigate|create (?:a|an|two|\w+) clue tokens?/i,
  ],
  removal: [
    /\b(?:destroy|exile) (?:another |up to (?:one|two|x) )?target (?:nonland |noncreature |nontoken |tapped |attacking |blocking |creature|artifact|enchantment|planeswalker|permanent|battle)/i,
    /\bcounter target (?:\w+ )?spell/i,
    /deals? (?:\d+|x|damage equal to [^.]*?) damage to (?:any target|target creature|target (?:creature or )?planeswalker|up to (?:one|two) target)/i,
    /target creature (?:an opponent controls )?gets -\d+\/-\d+|target creature gets -x\/-x/i,
    /\b(?:target|each) (?:opponent|player) sacrifices (?:a|an) (?:creature|attacking creature|nonland permanent|artifact|enchantment)/i,
    /\bfights? (?:target|another target|up to one target)/i,
    /(?:put|shuffle) target [^.]* into its owner's library/i,
    /return target (?:nonland )?(?:creature|permanent|artifact)[^.]* to its owner's hand/i,
  ],
  wipe: [
    /\b(?:destroy|exile) all (?:other )?(?:creatures|nonland permanents|artifacts|enchantments|planeswalkers|nontoken creatures|creatures (?:and|or)|creatures your opponents|attacking creatures|permanents)/i,
    /\b(?:all|each) (?:other )?creatures? (?:your opponents control )?gets? -(?:\d+|x)\/-(?:\d+|x)/i,
    /deals? (?:\d+|x) damage to each (?:other )?creature/i,
    /return all (?:nonland permanents|creatures|other creatures)[^.]* to their owners'? hands/i,
    /each (?:player|opponent) sacrifices (?:all|that many|\w+) creatures/i,
  ],
  protection: [
    /(?:gains?|gain|have|has|get)\b[^.]{0,60}\b(?:hexproof|indestructible|shroud|protection from)/i,
    /phases? out/i,
    /counter target (?:spell|ability) that targets/i,
  ],
  recursion: [
    /return [^.]*from (?:your|a) graveyard to (?:your hand|the battlefield)/i,
    /put [^.]*from (?:your|a) graveyard onto the battlefield/i,
    /(?:cast|play) [^.]*from your graveyard/i,
  ],
  tutor: [/search your library for (?:a|an|up to \w+) (?!basic land|land|forest|plains|island|swamp|mountain)[^.]*card/i],
};

const MLD_OR_LANDS = /\b(?:destroy|exile) all lands/i;

function frontType(c: CardInfo) {
  return c.typeLine.split("//")[0];
}
export function isLand(c: CardInfo) {
  return /\bLand\b/.test(frontType(c));
}
/** Modal double-faced card with a land back (counts as roughly half a land). */
export function isMdfcLand(c: CardInfo) {
  const [front, back] = c.typeLine.split("//");
  return !!back && /\bLand\b/.test(back) && !/\bLand\b/.test(front);
}

/** Which functions a card reliably performs, judged from its Oracle text. */
export function detectFunctions(c: CardInfo): Set<Fn> {
  const out = new Set<Fn>();
  const text = c.oracleText.replace(/\([^)]*\)/g, ""); // drop reminder text
  if (isLand(c)) {
    // lands only count for things beyond tapping for mana (e.g. Bojuka Bog-style removal is rare; keep it simple)
    if (RX.recursion.some((r) => r.test(text))) out.add("recursion");
    return out;
  }
  const permanent = /\b(?:Artifact|Creature|Enchantment|Planeswalker|Battle)\b/.test(frontType(c));
  for (const fn of FUNCTIONS) {
    for (const [k, r] of RX[fn].entries()) {
      if (fn === "ramp" && k === 0 && !permanent) continue; // a ritual isn't ramp
      if (r.test(text)) {
        out.add(fn);
        break;
      }
    }
  }
  if (out.has("wipe") && MLD_OR_LANDS.test(text) && !/creatures|nonland/.test(text)) out.delete("wipe");
  // a wipe usually also reads like removal; count it once, as a wipe
  if (out.has("wipe") && !RX.removal.some((r) => r.test(text.replace(/all [^.]*/gi, "")))) out.delete("removal");
  return out;
}

// ---- mana -------------------------------------------------------------------

const COLORS: Color[] = ["W", "U", "B", "R", "G"];

/** Colored pips per color in a mana cost (front face). Hybrid and Phyrexian count half. */
export function pips(cost: string): Record<Color, number> {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 } as Record<Color, number>;
  const front = cost.split("//")[0];
  for (const sym of front.match(/\{[^}]+\}/g) ?? []) {
    const parts = sym.slice(1, -1).toUpperCase().split("/");
    const colors = parts.filter((p): p is Color => (COLORS as string[]).includes(p));
    if (!colors.length) continue;
    const w = parts.length > 1 ? 0.5 : 1; // {W/U}, {G/P}, {2/W}
    for (const col of colors) out[col] += w;
  }
  return out;
}

/**
 * Karsten-style colored-source target for a 99-card deck (about 90% to cast on curve).
 * From the skill's table (references/constructed.md §3), extended for higher mana values.
 */
export function sourceTarget(pipCount: number, mv: number): number {
  const p = Math.round(pipCount);
  if (p <= 0) return 0;
  const generic = Math.max(0, mv - p);
  if (p === 1) return [19, 19, 18, 16, 15, 14][Math.min(generic, 5)];
  if (p === 2) return [30, 28, 26, 23, 22, 21][Math.min(generic, 5)];
  return [36, 33, 30, 28, 26, 25][Math.min(generic, 5)];
}

const FETCH_TYPES: Record<string, Color> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };

/** Colors a land can produce or fetch (limited to the deck's colors). */
export function landColors(c: CardInfo, deckColors: Color[], basicsInDeck: Set<Color>): Color[] {
  const produced = (c.producedMana ?? []).filter((x): x is Color => (COLORS as string[]).includes(x));
  const out = new Set<Color>(produced.filter((x) => deckColors.includes(x)));
  const t = c.oracleText.toLowerCase();
  const search = t.match(/search your library for ([^.]*?)card/);
  if (search) {
    const what = search[1];
    if (/basic land/.test(what)) for (const col of basicsInDeck) out.add(col);
    for (const [type, col] of Object.entries(FETCH_TYPES)) if (new RegExp(`\\b${type}\\b`).test(what) && deckColors.includes(col)) out.add(col);
  }
  if (/any color|one mana of any color/.test(t) && !produced.length) for (const col of deckColors) out.add(col);
  return [...out];
}

export function entersTapped(c: CardInfo): "tapped" | "conditional" | "untapped" {
  const t = c.oracleText.toLowerCase();
  if (!/enters (?:the battlefield )?tapped/.test(t)) return "untapped";
  return /tapped unless|tapped\. as .* you may|you may pay 2 life\. if you don't, it enters tapped|unless you control/.test(t) ? "conditional" : "tapped";
}

// ---- deck analysis --------------------------------------------------------------

export interface ColorReport {
  color: Color;
  pips: number; // total colored pips of this color in the 99 + commander
  sources: number; // lands (and MDFC lands) that make or fetch it
  target: number; // the source target of the most demanding early card (and the commander)
  hardest: string | null; // which card sets the target
}

export interface DeckAnalysis {
  lands: number; // real lands
  mdfcLands: number; // spells with a land back face
  tappedLands: number;
  counts: Record<Fn, number>; // detected by Oracle text, not Claude's tags
  template: Record<string, { have: number; want: readonly [number, number] }>;
  curve: number[]; // nonland cards by mana value 0..7+
  avgMv: number; // nonland cards, excluding the commander
  colors: ColorReport[];
  staples: string[]; // generically popular cards (top EDHREC ranks), not seeds
  stapleShare: number; // staples / nonland non-seed cards
  priceEur: number;
  budgetCapEur: number | null;
  /** Cards Claude tagged with a function that the Oracle text doesn't show. */
  unverifiedTags: { name: string; role: string }[];
  byCard: Record<string, Fn[]>;
}

export const BUDGET_CAP: Record<Budget, number | null> = { any: null, mid: 250, budget: 75 };
export const STAPLE_RANK = 300; // EDHREC rank at or below this = a generic staple

export function analyzeDeck(deck: Deck, opts: { budget?: Budget; seeds?: string[] } = {}): DeckAnalysis {
  const seeds = new Set((opts.seeds ?? []).map((s) => s.toLowerCase()));
  const commanders = [deck.commander, ...(deck.partner ? [deck.partner] : [])];
  const nine = deck.cards;
  const qtyOf = (c: DeckCard) => c.qty;
  const counts = Object.fromEntries(FUNCTIONS.map((f) => [f, 0])) as Record<Fn, number>;
  const byCard: Record<string, Fn[]> = {};
  const unverifiedTags: { name: string; role: string }[] = [];
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  let lands = 0;
  let mdfcLands = 0;
  let tapped = 0;
  let mvSum = 0;
  let mvN = 0;
  let price = 0;
  const staples: string[] = [];
  let nonlandOthers = 0;
  const basicsInDeck = new Set<Color>();
  for (const c of nine) {
    if (isBasicLand(c.name)) {
      const col = ({ plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" } as Record<string, Color>)[c.name.toLowerCase().replace(/^snow-covered /, "")];
      if (col) basicsInDeck.add(col);
    }
  }

  for (const c of nine) {
    const i = c.info;
    const q = qtyOf(c);
    if (i?.priceEur != null) price += i.priceEur * q;
    if (!i) {
      if (isBasicLand(c.name)) lands += q;
      continue;
    }
    if (isLand(i) || isBasicLand(c.name)) {
      lands += q;
      if (!isBasicLand(c.name) && entersTapped(i) === "tapped") tapped += q;
      continue;
    }
    if (isMdfcLand(i)) mdfcLands += q;
    const fns = detectFunctions(i);
    byCard[i.name] = [...fns];
    for (const f of fns) counts[f] += q;
    if (["ramp", "draw", "removal", "wipe", "protection", "recursion"].includes(c.role) && !fns.has(c.role as Fn)) unverifiedTags.push({ name: i.name, role: c.role });
    const mv = Math.round(i.cmc);
    curve[Math.min(mv, 7)] += q;
    mvSum += i.cmc * q;
    mvN += q;
    if (!seeds.has(i.name.toLowerCase())) {
      nonlandOthers += q;
      if (i.edhrecRank != null && i.edhrecRank <= STAPLE_RANK) staples.push(i.name);
    }
  }
  for (const c of commanders) if (c.info?.priceEur != null) price += c.info.priceEur;

  // colored sources vs demand
  const colors: ColorReport[] = [];
  for (const col of deck.colorIdentity) {
    let sources = 0;
    let pipTotal = 0;
    let target = 0;
    let hardest: string | null = null;
    for (const c of nine) {
      const i = c.info;
      if (!i) {
        if (isBasicLand(c.name) && basicColor(c.name) === col) sources += c.qty;
        continue;
      }
      if (isLand(i) || isMdfcLand(i) || isBasicLand(c.name)) {
        const lc = isBasicLand(c.name) ? [basicColor(c.name)].filter(Boolean) : landColors(i, deck.colorIdentity, basicsInDeck);
        if (lc.includes(col)) sources += c.qty;
        if (isLand(i) || isBasicLand(c.name)) continue;
      }
      const p = pips(i.manaCost)[col];
      pipTotal += p * c.qty;
      // early cards set the bar; a single 7-drop with CCC shouldn't
      if (p > 0 && i.cmc <= 4) {
        const t = sourceTarget(p, i.cmc);
        if (t > target) [target, hardest] = [t, i.name];
      }
    }
    for (const c of commanders) {
      const p = c.info ? pips(c.info.manaCost)[col] : 0;
      pipTotal += p;
      if (p > 0 && c.info) {
        const t = sourceTarget(p, Math.min(c.info.cmc, 6));
        if (t > target) [target, hardest] = [t, c.info.name];
      }
    }
    colors.push({ color: col, pips: pipTotal, sources, target, hardest });
  }

  const T = COMMANDER_TEMPLATE;
  return {
    lands,
    mdfcLands,
    tappedLands: tapped,
    counts,
    template: {
      lands: { have: lands, want: T.lands },
      ramp: { have: counts.ramp, want: T.ramp },
      draw: { have: counts.draw, want: T.draw },
      removal: { have: counts.removal, want: T.removal },
      wipe: { have: counts.wipe, want: T.wipe },
      protection: { have: counts.protection + counts.recursion, want: T.protection },
    },
    curve,
    avgMv: mvN ? Math.round((mvSum / mvN) * 100) / 100 : 0,
    colors,
    staples,
    stapleShare: nonlandOthers ? Math.round((staples.length / nonlandOthers) * 100) / 100 : 0,
    priceEur: Math.round(price * 100) / 100,
    budgetCapEur: BUDGET_CAP[opts.budget ?? "any"],
    unverifiedTags,
    byCard,
  };
}

function basicColor(name: string): Color | undefined {
  return ({ plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" } as Record<string, Color>)[name.toLowerCase().replace(/^snow-covered /, "")];
}

/** A compact plain-text report for Claude (review pass) and for humans (eval logs). */
export function analysisReport(a: DeckAnalysis): string {
  const t = a.template;
  const line = (k: string, label: string) => `${label} ${t[k].have} (template ${t[k].want[0]}–${t[k].want[1]})`;
  const out = [
    `Counted from Oracle text (not from your role tags): ${line("lands", "lands")}${a.mdfcLands ? ` + ${a.mdfcLands} MDFC land backs` : ""}; ${line("ramp", "ramp")}; ${line("draw", "card draw")}; ${line("removal", "targeted removal/interaction")}; ${line("wipe", "board wipes")}; ${line("protection", "protection+recursion")}; tutors ${a.counts.tutor}.`,
    `Curve (nonland, MV 0–7+): ${a.curve.join(" / ")}; average MV ${a.avgMv}. ${a.tappedLands} lands always enter tapped.`,
    `Colored sources (lands): ${a.colors.map((c) => `${c.color} ${c.sources}${c.target ? `/${c.target} wanted for ${c.hardest}` : ""}`).join(", ") || "colorless deck"}.`,
    `Generic staples (top-${STAPLE_RANK} EDHREC rank, not seeds): ${a.staples.length} of the nonland cards (${Math.round(a.stapleShare * 100)}%).`,
    `Price: about €${a.priceEur.toFixed(0)}${a.budgetCapEur ? ` (budget €${a.budgetCapEur})` : ""}.`,
  ];
  if (a.unverifiedTags.length) out.push(`Tags the card text doesn't support: ${a.unverifiedTags.slice(0, 15).map((u) => `${u.name} (${u.role})`).join(", ")}.`);
  return out.join("\n");
}

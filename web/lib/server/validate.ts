// Commander deck validation: a TypeScript port of mtg-master/scripts/deckcheck.py,
// plus the Bracket 3 checks. Returns errors (must fix) and warnings (worth a look).
import type { DeckShape } from "../shared/shape";
import { COMMANDER_TEMPLATE, bracketInfo } from "../shared/bracket";
import type { CardInfo, Color, Deck, DeckCard, Role, Validation } from "../shared/types";
import { BASIC_FOR_COLOR, ROLES, isBasicLand } from "../shared/types";
import { type DeckAnalysis, isLand, isMdfcLand, landColors, pips, sourceTarget } from "../shared/analysis";

const ANY_NUMBER = /a deck can have any number of cards named/i;
const UP_TO = /a deck can have up to (\w+) cards named/i;
const NUMBER_WORDS: Record<string, number> = { seven: 7, nine: 9 };

// Heuristics for bracket expectations (warnings, not errors)
export const MLD = [
  /destroy all lands/i,
  /each player sacrifices (all|that many|four|five|six|seven) lands/i,
  /lands don't untap/i,
  /exile all lands/i,
  /return all lands/i,
];
export const EXTRA_TURN = /take an extra turn/i;

export interface SubmittedDeck {
  deck_name?: string;
  commander: string;
  partner?: string | null;
  strategy?: string;
  win_conditions?: string[];
  bracket_notes?: string;
  cards: { name: string; role?: string; why?: string }[];
  basics?: Record<string, number>;
}

export type Lookup = Map<string, CardInfo>;

/** A list Claude sent as text: JSON (`["a", "b"]`), or the tail of one (`a", "b"]`), or one per line. */
function listFrom(t: string): string[] {
  const body = t.trim().replace(/^\[/, "").replace(/\]\s*\}?\s*$/, "");
  try {
    const v = JSON.parse(`[${body.startsWith('"') ? body : `"${body}`}]`);
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  } catch {}
  return body
    .split(/"\s*,\s*"|\n+/)
    .map((x) => x.replace(/^\s*["“]|["”]\s*$/g, "").trim())
    .filter(Boolean);
}

/**
 * The strategy and win conditions as the page shows them. Smaller models sometimes slip the rest of
 * the answer into the strategy string (`…plays. ", "win_conditions": ["Drain with…", "…"]`) or send
 * the win conditions as one string; this takes them apart again.
 */
export function untangleText(strategy: unknown, wins: unknown): { strategy: string; winConditions: string[] } {
  let text = typeof strategy === "string" ? strategy : "";
  let list = Array.isArray(wins) ? wins.map((w) => String(w ?? "").trim()).filter(Boolean) : typeof wins === "string" ? listFrom(wins) : [];
  // a JSON key inside the text: everything from there on wasn't meant to be prose
  const key = text.match(/["”]?\s*,?\s*\\?"(win_conditions|bracket_notes|deck_name|cards|basics)\\?"\s*:\s*/);
  if (key && key.index !== undefined) {
    const rest = text.slice(key.index + key[0].length);
    text = text.slice(0, key.index);
    if (key[1] === "win_conditions" && !list.length) list = listFrom(rest.split(/\]\s*,\s*"/)[0]);
  }
  // the text is (or ends in) a list of quoted items: `…", "…", "…"]`
  const tail = text.search(/["”]\s*,\s*["“]/);
  if (tail >= 0 && /["”]\s*\]\s*\}?\s*$/.test(text)) {
    const items = listFrom(text.slice(tail + 1).replace(/^\s*,\s*/, ""));
    const head = text.slice(0, tail).trim();
    if (!list.length) list = /^\s*\[/.test(text) ? listFrom(text) : items;
    text = /^\s*\[/.test(text) ? "" : head;
  } else if (/^\s*\[\s*["“]/.test(text) && /\]\s*$/.test(text)) {
    if (!list.length) list = listFrom(text);
    text = "";
  }
  return { strategy: text.replace(/^\s*["“]|["”]\s*$/g, "").trim().slice(0, 1600), winConditions: list.slice(0, 8) };
}

export function namesInSubmission(s: SubmittedDeck): string[] {
  return [s.commander, s.partner ?? "", ...s.cards.map((c) => c.name), ...Object.keys(s.basics ?? {})].filter(Boolean);
}

function normRole(r: string | undefined): Role {
  const v = String(r ?? "").toLowerCase().trim();
  return (ROLES as readonly string[]).includes(v) ? (v as Role) : "utility";
}

/** Build the Deck object (merging duplicates/basics) from a submission + Scryfall lookup. */
export function buildDeck(s: SubmittedDeck, lookup: Lookup, seeds: string[] = []): Deck {
  const seedSet = new Set(seeds.map((n) => n.toLowerCase()));
  const info = (n: string) => lookup.get(n.toLowerCase());
  const real = (n: string) => info(n)?.name ?? n.trim();
  const merged = new Map<string, DeckCard>();
  const add = (name: string, qty: number, role: Role, why: string) => {
    const key = real(name).toLowerCase();
    const cur = merged.get(key);
    if (cur) cur.qty += qty;
    else merged.set(key, { name: real(name), qty, role, why, info: info(name) });
  };
  for (const c of s.cards) add(c.name, 1, isBasicLand(c.name) ? "land" : normRole(c.role), (c.why ?? "").trim());
  for (const [name, qty] of Object.entries(s.basics ?? {})) {
    const n = Math.max(0, Math.round(Number(qty) || 0));
    if (n > 0) add(name, n, "land", "Basic land");
  }
  const cmd = (n: string): DeckCard => ({ name: real(n), qty: 1, role: "wincon", why: "Commander", info: info(n) });
  const commander = cmd(s.commander);
  const partner = s.partner ? cmd(s.partner) : undefined;
  // a commander accidentally listed in the 99 is dropped from the 99
  for (const c of [commander, partner]) if (c) merged.delete(c.name.toLowerCase());
  const cards = [...merged.values()];
  for (const c of [commander, partner, ...cards]) if (c && seedSet.has(c.name.toLowerCase())) c.seed = true;
  const identity = new Set<Color>([...(commander.info?.colorIdentity ?? []), ...(partner?.info?.colorIdentity ?? [])]);
  return {
    name: (s.deck_name ?? "").trim() || `${commander.name} Upgraded`,
    commander,
    partner,
    cards,
    ...untangleText(s.strategy, s.win_conditions),
    bracketNotes: (s.bracket_notes ?? "").trim(),
    colorIdentity: (["W", "U", "B", "R", "G"] as Color[]).filter((c) => identity.has(c)),
  };
}

/** The abilities that let a card share the command zone (rule 702.124 and its relatives). */
export interface PairingAbilities {
  partner: boolean; // plain "Partner"
  partnerWith?: string; // "Partner with NAME"
  partnerGroup?: string; // "Partner—Father & son", "Partner—Survivors"… (lower-cased name)
  friendsForever: boolean;
  choosesBackground: boolean;
  isBackground: boolean;
  doctorsCompanion: boolean;
  isDoctor: boolean;
}

export function pairingAbilities(c: CardInfo): PairingAbilities {
  const t = c.oracleText.replace(/\([^)]*\)/g, ""); // reminder text repeats the keyword
  const group = t.match(/(?:^|\n)Partner\s*[—–-]\s*([^\n(]+?)\s*(?:\n|$)/)?.[1]?.trim();
  const friends = /(?:^|\n)Friends forever\b/i.test(t) || group?.toLowerCase() === "friends forever";
  return {
    partner: /(?:^|\n)Partner\s*(?:\n|$)/.test(t),
    partnerWith: t.match(/(?:^|\n)Partner with ([^\n(]+?)\s*(?:\n|$)/)?.[1]?.trim(),
    partnerGroup: friends ? undefined : group?.toLowerCase(),
    friendsForever: friends,
    choosesBackground: /choose a background/i.test(t),
    isBackground: /\bBackground\b/.test(c.typeLine),
    doctorsCompanion: /doctor's companion/i.test(t),
    isDoctor: /Time Lord Doctor/.test(c.typeLine),
  };
}

/** Short description of how a card can pair, for prompts ("" if it can't). */
export function pairingLabel(c: CardInfo): string {
  const p = pairingAbilities(c);
  if (p.partnerWith) return `Partner with ${p.partnerWith}`;
  if (p.partnerGroup) return `Partner—${c.oracleText.match(/Partner\s*[—–-]\s*([^\n(]+?)\s*(?:\(|\n|$)/)?.[1]?.trim()}: a second commander must have the same Partner— ability`;
  if (p.partner) return "Partner: a second commander must also have plain Partner";
  if (p.friendsForever) return "Friends forever: a second commander must also have Friends forever";
  if (p.choosesBackground) return "Choose a Background: a Background enchantment can be the second commander";
  if (p.doctorsCompanion) return "Doctor's companion: a Time Lord Doctor can be the second commander";
  return "";
}

/** Can these two cards be co-commanders? Returns null if yes, or the reason they can't. */
export function pairingProblem(a: CardInfo, b: CardInfo): string | null {
  const pa = pairingAbilities(a);
  const pb = pairingAbilities(b);
  if (pa.partnerWith || pb.partnerWith) {
    if (pa.partnerWith?.toLowerCase() === b.name.toLowerCase() && pb.partnerWith?.toLowerCase() === a.name.toLowerCase()) return null;
    return `${pa.partnerWith ? a.name : b.name} can only partner with ${pa.partnerWith ?? pb.partnerWith}.`;
  }
  if (pa.partnerGroup || pb.partnerGroup) {
    if (pa.partnerGroup && pa.partnerGroup === pb.partnerGroup) return null;
    const [has, other] = pa.partnerGroup ? [a, b] : [b, a];
    const label = has.oracleText.match(/Partner\s*[—–-]\s*([^\n(]+?)\s*(?:\(|\n|$)/)?.[1]?.trim();
    return `${has.name} has Partner—${label}, so the second commander must have Partner—${label} too (${other.name} doesn't).`;
  }
  if (pa.partner && pb.partner) return null;
  if ((pa.choosesBackground && pb.isBackground) || (pb.choosesBackground && pa.isBackground)) return null;
  if (pa.friendsForever && pb.friendsForever) return null;
  if ((pa.doctorsCompanion && pb.isDoctor) || (pb.doctorsCompanion && pa.isDoctor)) return null;
  return `${a.name} and ${b.name} can't be paired as commanders (they need matching Partner, Partner—[name], Friends forever, Background or Doctor's companion abilities).`;
}

export function validateDeck(deck: Deck, notFound: string[], seeds: string[] = [], opts: { commander?: string | null; bracket?: number } = {}): Validation {
  const BRACKET = bracketInfo(opts.bracket ?? deck.bracket ?? 3);
  const errors: string[] = [];
  const warnings: string[] = [];
  const commanders = [deck.commander, ...(deck.partner ? [deck.partner] : [])];
  const total = commanders.length + deck.cards.reduce((n, c) => n + c.qty, 0);

  for (const n of notFound) errors.push(`"${n}" was not found on Scryfall (typo, wrong name, or not a real card). Use the exact English card name.`);

  // size
  if (total !== 100) {
    const diff = total - 100;
    errors.push(`Deck has ${total} cards including the commander; Commander needs exactly 100 (${diff > 0 ? `remove ${diff}` : `add ${-diff}`}).`);
  }

  // commander checks
  const ident = new Set<Color>(deck.colorIdentity);
  if (opts.commander) {
    const chosen = opts.commander.toLowerCase();
    if (!commanders.some((c) => c.name.toLowerCase() === chosen || c.info?.name.toLowerCase() === chosen)) {
      errors.push(`The user chose ${opts.commander} as the commander, but the deck is led by ${deck.commander.name}. Use ${opts.commander} as the commander.`);
    }
  }
  for (const c of commanders) {
    if (!c.info) continue;
    const background = c === deck.partner && /\bBackground\b/.test(c.info.typeLine);
    if (!c.info.canBeCommander && !background) errors.push(`${c.name} can't be a commander (it isn't a legendary creature and doesn't say it can be your commander).`);
    if (c.info.legalCommander === "banned") errors.push(`${c.name} is BANNED in Commander.`);
  }
  if (deck.partner?.info && deck.commander.info) {
    const why = pairingProblem(deck.commander.info, deck.partner.info);
    if (why) errors.push(why);
  }

  // per-card checks
  let gameChangers: string[] = [];
  let extraTurns = 0;
  for (const c of [...commanders, ...deck.cards]) {
    const i = c.info;
    if (!i) {
      if (!notFound.some((n) => n.toLowerCase() === c.name.toLowerCase())) errors.push(`Couldn't verify "${c.name}" on Scryfall. Check the exact card name.`);
      continue;
    }
    const basic = isBasicLand(i.name);
    if (!basic && c.qty > 1) {
      const t = i.oracleText;
      const upTo = t.match(UP_TO);
      const limit = ANY_NUMBER.test(t) ? Infinity : upTo ? NUMBER_WORDS[upTo[1].toLowerCase()] ?? 1 : 1;
      if (c.qty > limit) errors.push(`${c.qty} copies of ${i.name}: Commander is singleton (1 copy).`);
    }
    if (i.legalCommander === "banned") {
      if (!commanders.includes(c)) errors.push(`${i.name} is BANNED in Commander.`);
    } else if (i.legalCommander === "not_legal") {
      errors.push(`${i.name} is not legal in Commander (e.g. Un-set, Alchemy-only or token card).`);
    }
    if (!commanders.includes(c)) {
      const outside = i.colorIdentity.filter((x) => !ident.has(x));
      if (outside.length) errors.push(`${i.name} (${i.colorIdentity.join("")}) is outside the commander's color identity (${deck.colorIdentity.join("") || "colorless"}).`);
    }
    if (i.gameChanger) gameChangers.push(i.name);
    if (BRACKET.number <= 3 && MLD.some((re) => re.test(i.oracleText))) warnings.push(`${i.name} looks like mass land denial, which Bracket ${BRACKET.number} tables don't expect.`);
    if (EXTRA_TURN.test(i.oracleText)) extraTurns += c.qty;
  }
  gameChangers = [...new Set(gameChangers)];
  if (gameChangers.length > BRACKET.maxGameChangers) {
    // the user's own picks can't be cut: only the cards Claude added count against the limit
    const picked = new Set(seeds.map((x) => x.toLowerCase()));
    const added = gameChangers.filter((g) => !picked.has(g.toLowerCase()));
    const allowed = Math.max(0, BRACKET.maxGameChangers - (gameChangers.length - added.length));
    if (added.length > allowed) {
      const cut = added.length - allowed;
      errors.push(
        BRACKET.maxGameChangers === 0
          ? `${added.length} Game Changer${added.length > 1 ? "s" : ""} (${added.join(", ")}): Bracket ${BRACKET.number} allows none. Cut ${added.length > 1 ? "them" : "it"}.`
          : `${gameChangers.length} Game Changers (${gameChangers.join(", ")}); Bracket ${BRACKET.number} allows at most ${BRACKET.maxGameChangers}. Cut ${cut}${added.length < gameChangers.length ? ` of ${added.join(", ")}` : ""}.`,
      );
    }
    if (added.length < gameChangers.length && gameChangers.length - added.length > BRACKET.maxGameChangers)
      warnings.push(`Your own cards include ${gameChangers.length - added.length} Game Changer(s), more than Bracket ${BRACKET.number} allows; the deck plays above that bracket.`);
  }
  if (extraTurns > 2 && BRACKET.number <= 3) warnings.push(`${extraTurns} extra-turn cards: Bracket ${BRACKET.number} expects only a few and never chained.`);

  // seeds
  for (const s of seeds) {
    const inDeck = [...commanders, ...deck.cards].some((c) => c.name.toLowerCase() === s.toLowerCase() || c.info?.name.toLowerCase() === s.toLowerCase());
    if (!inDeck)
      errors.push(seeds.length > 5 ? `"${s}" from the user's deck is missing. Keep every card the user started with.` : `Seed card "${s}" is missing. All five seed cards must be in the deck (or be the commander).`);
  }

  // shape vs the template (warnings)
  const count = (r: Role) => deck.cards.filter((c) => c.role === r).reduce((n, c) => n + c.qty, 0);
  const lands = deck.cards.filter((c) => /\bLand\b/.test((c.info?.typeLine ?? "").split("//")[0]) || isBasicLand(c.name)).reduce((n, c) => n + c.qty, 0);
  if (lands < COMMANDER_TEMPLATE.lands[0] - 2 || lands > COMMANDER_TEMPLATE.lands[1] + 2) warnings.push(`${lands} lands; the usual range is ${COMMANDER_TEMPLATE.lands[0]}–${COMMANDER_TEMPLATE.lands[1]}.`);
  for (const r of ["ramp", "draw", "removal"] as const) {
    const n = count(r);
    if (n < COMMANDER_TEMPLATE[r][0] - 2) warnings.push(`Only ${n} cards tagged ${r}; the template suggests ${COMMANDER_TEMPLATE[r][0]}–${COMMANDER_TEMPLATE[r][1]}.`);
  }
  if (count("wipe") === 0) warnings.push("No board wipes.");

  return { ok: errors.length === 0, errors, warnings, total, gameChangers };
}

/**
 * Last-resort repair when the model keeps missing 100 by a few cards:
 * add/remove basic lands (largest pile first, split by color pips). Returns a note or null.
 */
export function repairCount(deck: Deck): string | null {
  const total = 1 + (deck.partner ? 1 : 0) + deck.cards.reduce((n, c) => n + c.qty, 0);
  let diff = 100 - total;
  if (diff === 0 || Math.abs(diff) > 8) return null;
  const colors = deck.colorIdentity.length ? deck.colorIdentity : (["C"] as unknown as Color[]);
  const basics = () => deck.cards.filter((c) => isBasicLand(c.name)).sort((a, b) => b.qty - a.qty);
  const note = diff > 0 ? `Added ${diff} basic land(s) to reach 100.` : `Removed ${-diff} basic land(s) to reach 100.`;
  let guard = 0;
  while (diff !== 0 && guard++ < 50) {
    if (diff > 0) {
      const color = colors[guard % colors.length];
      const name = BASIC_FOR_COLOR[color as Color] ?? "Wastes";
      const ex = deck.cards.find((c) => c.name === name);
      if (ex) ex.qty++;
      else deck.cards.push({ name, qty: 1, role: "land", why: "Basic land" });
      diff--;
    } else {
      const b = basics()[0];
      if (!b) return null;
      b.qty--;
      if (b.qty === 0) deck.cards.splice(deck.cards.indexOf(b), 1);
      diff++;
    }
  }
  return note;
}

/**
 * Stricter checks from the objective analysis (engine flag "strict"). Thresholds sit well
 * below the template so a heuristic miss rarely blocks a reasonable deck; the template itself
 * stays a warning.
 */
export function strictProblems(a: DeckAnalysis, shape?: DeckShape): string[] {
  const out: string[] = [];
  // the user's own limits replace the template for the counts they set
  const own = (k: string) => !!(shape as Record<string, unknown> | undefined)?.[k];
  const named = (fn: string) => Object.entries(a.byCard).filter(([, f]) => (f as string[]).includes(fn)).map(([n]) => n);
  const landEq = a.lands + a.mdfcLands * 0.5;
  if (!own("lands") && landEq < 33) out.push(`Only ${a.lands} lands${a.mdfcLands ? ` (+${a.mdfcLands} MDFC land backs)` : ""}: a Commander deck needs about 35–38. Add ${Math.ceil(35 - landEq)} lands.`);
  // landfall and lands-matter decks run 40+ on purpose; only flag the extreme
  if (!own("lands") && a.lands > 44) out.push(`${a.lands} lands is too many even for a lands deck; the usual range is 35–38 (up to ~42 for landfall). Cut ${a.lands - 42}.`);
  const mins: [string, string, number, string][] = [
    ["ramp", "ramp", 7, "mana rocks and dorks, land-fetching spells, Treasure makers"],
    ["draw", "card draw", 7, "cards that draw, impulse-draw or make Clues"],
    ["removal", "targeted removal/interaction", 5, "destroy/exile/counter/damage/edict/bounce effects that target"],
  ];
  for (const [fn, label, min, what] of mins) {
    const have = a.counts[fn as keyof typeof a.counts];
    if (!own(fn) && have < min) {
      const list = named(fn);
      out.push(`The card text shows only ${have} ${label} card(s)${list.length ? ` (${list.join(", ")})` : ""}; the template wants ${a.template[fn].want[0]}–${a.template[fn].want[1]}. Add at least ${min - have} (counted: ${what}).`);
    }
  }
  const multi = a.colors.length >= 3;
  for (const c of a.colors) {
    if (!c.target) continue;
    const floor = Math.max(8, Math.round(c.target * (multi ? 0.5 : 0.6)));
    if (c.sources < floor) out.push(`Only ${c.sources} lands make or fetch ${c.color} mana, but ${c.hardest} wants about ${c.target} ${c.color} sources. Get to at least ${floor} with duals, fetches or more ${BASIC_FOR_COLOR[c.color]}s.`);
  }
  return out;
}

/**
 * Re-split the basic lands across the deck's colors (engine flag "manabase"): each basic goes to
 * the color furthest below its colored-source target, then by share of colored pips.
 * Keeps the total number of basics. Returns a note when it changed something.
 */
export function rebalanceBasics(deck: Deck): string | null {
  const colors = deck.colorIdentity;
  const basics = deck.cards.filter((c) => isBasicLand(c.name) && !/^(snow-covered )?wastes$/i.test(c.name));
  const total = basics.reduce((n, c) => n + c.qty, 0);
  if (!colors.length || !total) return null;
  // snow or not, per basic type: a color stays snow only if all its basics were snow;
  // a color that had no basics follows the rest of the deck
  const isSnow = (n: string) => /^snow-covered /i.test(n);
  const allSnow = basics.every((c) => isSnow(c.name));
  const snowFor = (col: Color) => {
    const own = basics.filter((c) => c.name.toLowerCase().replace(/^snow-covered /, "") === BASIC_FOR_COLOR[col].toLowerCase());
    return own.length ? own.every((c) => isSnow(c.name)) : allSnow;
  };
  const before = Object.fromEntries(basics.map((c) => [c.name, c.qty]));

  const sources: Record<string, number> = {};
  const pipShare: Record<string, number> = {}; // colored pips, weighted: cheap spells and the commander count more
  const reqs: Record<string, number[]> = {}; // source targets of the early cards in each color
  const cmdReq: Record<string, number> = {};
  for (const col of colors) [sources[col], pipShare[col], reqs[col], cmdReq[col]] = [0, 0, [], 0];
  const basicsAll = new Set<Color>(colors);
  const weight = (mv: number) => (mv <= 2 ? 1.5 : mv <= 4 ? 1.2 : 1);
  for (const c of deck.cards) {
    const i = c.info;
    if (!i || isBasicLand(c.name)) continue;
    if (isLand(i) || isMdfcLand(i)) for (const col of landColors(i, colors, basicsAll)) sources[col] += c.qty;
    if (isLand(i)) continue;
    const p = pips(i.manaCost);
    for (const col of colors) {
      pipShare[col] += p[col] * c.qty * weight(i.cmc);
      if (p[col] > 0 && i.cmc <= 4) reqs[col].push(sourceTarget(p[col], i.cmc));
    }
  }
  for (const cmd of [deck.commander, deck.partner]) {
    const i = cmd?.info;
    if (!i) continue;
    const p = pips(i.manaCost);
    for (const col of colors) {
      pipShare[col] += p[col] * 3; // the commander is cast every game
      if (p[col] > 0) cmdReq[col] = Math.max(cmdReq[col], sourceTarget(p[col], Math.min(i.cmc, 6)));
    }
  }
  // A color's target: what the commander needs, or the second most demanding early card.
  // One lone Counterspell shouldn't make blue look as hungry as the deck's main color;
  // a color with a single early card is a splash.
  const target: Record<string, number> = {};
  for (const col of colors) {
    const r = [...reqs[col]].sort((x, y) => y - x);
    const cards = r.length >= 2 ? r[1] : r.length === 1 ? Math.round(r[0] * 0.6) : 0;
    target[col] = Math.max(cmdReq[col], cards);
  }
  const demand = colors.filter((col) => pipShare[col] > 0 || target[col] > 0);
  const use = demand.length ? demand : colors;
  const pipsTotal = use.reduce((n, col) => n + pipShare[col], 0) || 1;
  const alloc: Record<string, number> = Object.fromEntries(use.map((col) => [col, 0]));
  for (let k = 0; k < total; k++) {
    const pick = [...use].sort((x, y) => {
      const gx = target[x] ? (target[x] - sources[x] - alloc[x]) / target[x] : -1;
      const gy = target[y] ? (target[y] - sources[y] - alloc[y]) / target[y] : -1;
      if (gx > 0 || gy > 0) return gy - gx;
      // all targets met: follow the (weighted) share of colored pips
      return pipShare[y] / pipsTotal - alloc[y] / total - (pipShare[x] / pipsTotal - alloc[x] / total);
    })[0];
    alloc[pick]++;
  }
  const name = (col: Color) => (snowFor(col) ? `Snow-Covered ${BASIC_FOR_COLOR[col]}` : BASIC_FOR_COLOR[col]);
  const after: Record<string, number> = {};
  for (const col of use) if (alloc[col]) after[name(col as Color)] = alloc[col];
  const same = Object.keys(before).length === Object.keys(after).length && Object.entries(after).every(([n, q]) => before[n] === q);
  if (same) return null;
  // replace the basics in place
  for (const b of basics) deck.cards.splice(deck.cards.indexOf(b), 1);
  for (const [n, q] of Object.entries(after)) {
    const old = basics.find((b) => b.name === n);
    deck.cards.push({ name: n, qty: q, role: "land", why: "Basic land", info: old?.info });
  }
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([n, q]) => `${q} ${n}`).join(", ");
  return `Re-split the ${total} basic lands to ${fmt(after)} (was ${fmt(before)}) to match colored-source needs.`;
}

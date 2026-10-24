// Commander deck validation: a TypeScript port of mtg-master/scripts/deckcheck.py,
// plus the Bracket 3 checks. Returns errors (must fix) and warnings (worth a look).
import { BRACKET, COMMANDER_TEMPLATE } from "../shared/bracket";
import type { CardInfo, Color, Deck, DeckCard, Role, Validation } from "../shared/types";
import { BASIC_FOR_COLOR, ROLES, isBasicLand } from "../shared/types";

const ANY_NUMBER = /a deck can have any number of cards named/i;
const UP_TO = /a deck can have up to (\w+) cards named/i;
const NUMBER_WORDS: Record<string, number> = { seven: 7, nine: 9 };

// Heuristics for bracket expectations (warnings, not errors)
const MLD = [
  /destroy all lands/i,
  /each player sacrifices (all|that many|four|five|six|seven) lands/i,
  /lands don't untap/i,
  /exile all lands/i,
  /return all lands/i,
];
const EXTRA_TURN = /take an extra turn/i;

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
    strategy: (s.strategy ?? "").trim(),
    winConditions: (s.win_conditions ?? []).filter(Boolean),
    bracketNotes: (s.bracket_notes ?? "").trim(),
    colorIdentity: (["W", "U", "B", "R", "G"] as Color[]).filter((c) => identity.has(c)),
  };
}

/** Can these two cards be co-commanders? Returns null if yes, or the reason they can't. */
export function pairingProblem(a: CardInfo, b: CardInfo): string | null {
  const t = (c: CardInfo) => c.oracleText;
  const partnerWith = (c: CardInfo) => t(c).match(/Partner with ([^\n(]+?)(?:\s*\(|\n|$)/)?.[1]?.trim();
  const plainPartner = (c: CardInfo) => /(^|\n)Partner(\s*\(|\s*$|\n)/.test(t(c));
  const isBackground = (c: CardInfo) => /\bBackground\b/.test(c.typeLine);
  const choosesBackground = (c: CardInfo) => /choose a background/i.test(t(c));
  const friends = (c: CardInfo) => /friends forever/i.test(t(c));
  const companionOf = (c: CardInfo) => /doctor's companion/i.test(t(c));
  const isDoctor = (c: CardInfo) => /Time Lord Doctor/.test(c.typeLine);
  const pw = [partnerWith(a), partnerWith(b)];
  if (pw[0] || pw[1]) {
    if (pw[0]?.toLowerCase() === b.name.toLowerCase() && pw[1]?.toLowerCase() === a.name.toLowerCase()) return null;
    return `${pw[0] ? a.name : b.name} can only partner with ${pw[0] ?? pw[1]}.`;
  }
  if (plainPartner(a) && plainPartner(b)) return null;
  if ((choosesBackground(a) && isBackground(b)) || (choosesBackground(b) && isBackground(a))) return null;
  if (friends(a) && friends(b)) return null;
  if ((companionOf(a) && isDoctor(b)) || (companionOf(b) && isDoctor(a))) return null;
  return `${a.name} and ${b.name} can't be paired as commanders (they need matching Partner, Friends forever, Background or Doctor's companion abilities).`;
}

export function validateDeck(deck: Deck, notFound: string[], seeds: string[] = [], opts: { commander?: string | null } = {}): Validation {
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
    if (MLD.some((re) => re.test(i.oracleText))) warnings.push(`${i.name} looks like mass land denial, which Bracket 3 tables don't expect.`);
    if (EXTRA_TURN.test(i.oracleText)) extraTurns += c.qty;
  }
  gameChangers = [...new Set(gameChangers)];
  if (gameChangers.length > BRACKET.maxGameChangers) {
    errors.push(`${gameChangers.length} Game Changers (${gameChangers.join(", ")}); Bracket 3 allows at most ${BRACKET.maxGameChangers}. Cut ${gameChangers.length - BRACKET.maxGameChangers}.`);
  }
  if (extraTurns > 2) warnings.push(`${extraTurns} extra-turn cards: Bracket 3 expects only a few and never chained.`);

  // seeds
  for (const s of seeds) {
    const inDeck = [...commanders, ...deck.cards].some((c) => c.name.toLowerCase() === s.toLowerCase() || c.info?.name.toLowerCase() === s.toLowerCase());
    if (!inDeck) errors.push(`Seed card "${s}" is missing. All five seed cards must be in the deck (or be the commander).`);
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

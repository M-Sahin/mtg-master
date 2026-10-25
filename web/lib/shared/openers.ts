// Opening-hand check: goldfish thousands of games with the finished deck and count how often
// its mana works. Pure and deterministic (seeded shuffle), so the deck view, the bracket
// checker, the engine's review and the eval all see the same numbers. No API calls.
//
// What a simulated game does (an estimate, not a full game):
// - Shuffle the 99, draw 7. Commander mulligan: the first mulligan is free, later ones bottom a
//   card each (London). Keep 3–5 lands, or 2 lands with cheap ramp or two cheap spells; at 6 cards keep
//   2–5 lands; always keep 5.
// - Draw every turn, turn 1 included (Commander is multiplayer: nobody skips the first draw).
// - Each turn: play a land (an untapped one that adds a missing commander color first), cast the
//   commander as soon as the mana and colors allow it, otherwise cast cheap ramp.
// - Ramp: mana rocks work the turn they come down, mana creatures and land-search spells from
//   the next turn. Sol Ring-style rocks count for what they add.
import { castableText, detectFunctions, isLand, isMdfcLand, landColors, entersTapped, pips } from "./analysis";
import type { CardInfo, Color, Deck } from "./types";

export interface OpenerReport {
  games: number;
  /** Share of first 7-card hands with 0, 1, … 7 lands (MDFC lands count as lands). */
  openingLands: number[];
  /** Kept the first 7; needed only the free mulligan; went to 6 cards or fewer. */
  keep7: number;
  freeMulligan: number;
  toSixOrFewer: number;
  /** Lands on the battlefield on turn 3 and turn 4, at least 3 and 4. */
  landDrop3: number;
  landDrop4: number;
  /** Seven or more lands among the first 14 cards seen (turn 7): flooding. */
  flood: number;
  /** Per deck color: a source of it on the battlefield by turn 3. */
  colorByTurn3: { color: Color; share: number }[];
  /** Per commander: cast on curve (the turn its mana value says), and one turn later. */
  commanders: { name: string; mv: number; onCurve: number; oneLate: number }[];
}

type Source = { colors: Set<Color | "C">; amount: number };
type Sim = {
  name: string;
  land: boolean;
  mdfc: boolean;
  tapped: boolean;
  landColors: Color[];
  mv: number;
  ramp: null | { kind: "rock" | "dork" | "land"; amount: number; colors: Set<Color | "C"> };
};

const COLORS: Color[] = ["W", "U", "B", "R", "G"];

/** Seeded PRNG (mulberry32), so a deck always gets the same numbers. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How a card behaves for mana in the simulation. */
function simCard(name: string, i: CardInfo | undefined, deckColors: Color[], basics: Set<Color>): Sim {
  if (!i) return { name, land: false, mdfc: false, tapped: false, landColors: [], mv: 3, ramp: null };
  if (isLand(i)) {
    const t = entersTapped(i);
    return { name, land: true, mdfc: false, tapped: t === "tapped", landColors: landColors(i, deckColors, basics), mv: 0, ramp: null };
  }
  const mdfc = isMdfcLand(i);
  let ramp: Sim["ramp"] = null;
  if (i.cmc <= 3 && detectFunctions(i).has("ramp")) {
    const text = castableText(i);
    const permanent = /\b(?:Artifact|Creature|Enchantment)\b/.test(i.typeLine.split("//")[0]);
    const produced = new Set<Color | "C">((i.producedMana ?? []).filter((x): x is Color | "C" => x === "C" || (COLORS as string[]).includes(x)).filter((x) => x === "C" || deckColors.includes(x as Color)));
    if (/search your library for [^.]*land/i.test(text)) {
      ramp = { kind: "land", amount: 1, colors: new Set(basics.size ? basics : deckColors) };
    } else if (permanent && produced.size) {
      // "{T}: Add {C}{C}" (Sol Ring) adds two
      const add = text.match(/\{T\}[^:]*: Add ((?:\{[^}]+\})+)/);
      const amount = add ? Math.max(1, (add[1].match(/\{/g) ?? []).length) : 1;
      if (/any color/i.test(text)) for (const c of deckColors) produced.add(c);
      ramp = { kind: /\bCreature\b/.test(i.typeLine) ? "dork" : "rock", amount: Math.min(amount, 3), colors: produced };
    }
  }
  // an MDFC land is played as a tapped-or-untapped land of its back face; treat it as untapped
  const back = mdfc ? landColors(i, deckColors, basics) : [];
  return { name, land: false, mdfc, tapped: false, landColors: back.length ? back : deckColors.slice(0, 1), mv: i.cmc, ramp };
}

/** Can these sources pay this cost? Colored pips first, each from the source with the fewest colors. */
export function canPay(sources: Source[], cost: Record<Color, number>, mv: number): boolean {
  const units: Set<Color | "C">[] = [];
  for (const s of sources) for (let k = 0; k < s.amount; k++) units.push(s.colors);
  if (units.length < mv) return false;
  const used = new Array(units.length).fill(false);
  const need: Color[] = [];
  for (const c of COLORS) for (let k = 0; k < Math.ceil(cost[c]); k++) need.push(c);
  // the scarcest color first
  need.sort((x, y) => units.filter((u) => u.has(x)).length - units.filter((u) => u.has(y)).length);
  for (const c of need) {
    let best = -1;
    for (let k = 0; k < units.length; k++) if (!used[k] && units[k].has(c) && (best < 0 || units[k].size < units[best].size)) best = k;
    if (best < 0) return false;
    used[best] = true;
  }
  return true;
}

export function simulateOpeners(deck: Deck, opts: { games?: number; seed?: number } = {}): OpenerReport {
  const games = opts.games ?? 4000;
  const deckColors = deck.colorIdentity.length ? deck.colorIdentity : COLORS;
  const basics = new Set<Color>();
  const BASIC: Record<string, Color> = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };
  for (const c of deck.cards) {
    const b = BASIC[c.name.replace(/^Snow-Covered /, "")];
    if (b) basics.add(b);
  }
  const lib: Sim[] = [];
  for (const c of deck.cards) {
    const s = simCard(c.name, c.info, deckColors, basics);
    for (let k = 0; k < c.qty; k++) lib.push(s);
  }
  const cmds = [deck.commander, deck.partner].filter((c): c is NonNullable<typeof c> => !!c?.info);
  const cmdCost = cmds.map((c) => ({ name: c.name, mv: c.info!.cmc, cost: pips(c.info!.manaCost) }));

  const rand = rng(opts.seed ?? hash(lib.map((c) => c.name).join("|")));
  const openingLands = new Array(8).fill(0);
  let keep7 = 0, free = 0, six = 0, drop3 = 0, drop4 = 0, flood = 0;
  const color3: Record<string, number> = Object.fromEntries(deckColors.map((c) => [c, 0]));
  const onCurve = cmdCost.map(() => 0);
  const oneLate = cmdCost.map(() => 0);
  const landish = (c: Sim) => c.land || c.mdfc;

  const shuffle = () => {
    const a = lib.slice();
    for (let k = a.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [a[k], a[j]] = [a[j], a[k]];
    }
    return a;
  };
  const keepable = (hand: Sim[], size: number) => {
    const l = hand.filter(landish).length;
    if (size <= 5) return true;
    if (size === 6) return l >= 2 && l <= 5;
    return (l >= 3 && l <= 5) || (l === 2 && (hand.some((c) => c.ramp && c.mv <= 2) || hand.filter((c) => !landish(c) && c.mv <= 2).length >= 2));
  };

  for (let g = 0; g < games; g++) {
    // ---- mulligans
    let order = shuffle();
    let hand = order.slice(0, 7);
    let pos = 7;
    const first = hand.filter(landish).length;
    openingLands[first]++;
    let mulls = 0;
    while (!keepable(hand, 7 - Math.max(0, mulls - 1)) && mulls < 3) {
      mulls++;
      order = shuffle();
      hand = order.slice(0, 7);
      pos = 7;
    }
    const bottom = Math.max(0, mulls - 1);
    if (bottom) {
      // bottom extra lands past four, else the most expensive spells
      const sorted = [...hand].sort((x, y) => score(y, hand) - score(x, hand));
      const out = sorted.slice(0, bottom);
      hand = hand.filter((c) => {
        const k = out.indexOf(c);
        if (k < 0) return true;
        out.splice(k, 1);
        return false;
      });
    }
    if (mulls === 0) keep7++;
    else if (mulls === 1) free++;
    else six++;

    // ---- turns
    const battlefield: { sim: Sim; from: number }[] = []; // lands and ramp, with the turn they work from
    let landsSeen = hand.filter(landish).length;
    let seen = hand.length;
    const cast = cmdCost.map(() => 0);
    for (let turn = 1; turn <= 8; turn++) {
      const draw = order[pos++];
      if (draw) {
        hand.push(draw);
        seen++;
        if (seen <= 14 && landish(draw)) landsSeen++;
      }
      // land drop: untapped first, preferring a color the commander still lacks
      const have = new Set<Color>();
      for (const b of battlefield) for (const c of b.sim.land ? b.sim.landColors : [...(b.sim.ramp?.colors ?? [])]) if (c !== "C") have.add(c as Color);
      const wants = new Set<Color>(cmdCost.flatMap((c) => COLORS.filter((x) => c.cost[x] > 0 && !have.has(x))));
      const lands = hand.filter((c) => c.land);
      const pool = lands.length ? lands : hand.filter((c) => c.mdfc);
      const rank = (c: Sim) => (c.tapped ? 0 : 10) + c.landColors.filter((x) => wants.has(x)).length * 3 + c.landColors.length;
      if (pool.length) {
        const pick = [...pool].sort((x, y) => rank(y) - rank(x))[0];
        hand.splice(hand.indexOf(pick), 1);
        battlefield.push({ sim: { ...pick, land: true }, from: pick.tapped ? turn + 1 : turn });
      }
      const sources = (): Source[] =>
        battlefield.filter((b) => b.from <= turn).map((b) => (b.sim.land ? { colors: new Set<Color | "C">(b.sim.landColors.length ? b.sim.landColors : ["C"]), amount: 1 } : { colors: b.sim.ramp!.colors, amount: b.sim.ramp!.amount }));
      let spent = 0;
      // commanders first
      cmdCost.forEach((c, k) => {
        if (cast[k]) return;
        const src = sources();
        const total = src.reduce((n, s) => n + s.amount, 0) - spent;
        if (total >= c.mv && canPay(src, c.cost, c.mv + spent)) {
          cast[k] = turn;
          spent += c.mv;
        }
      });
      // then cheap ramp with what's left
      const ramps = hand.filter((c) => c.ramp).sort((x, y) => x.mv - y.mv);
      for (const r of ramps) {
        const total = sources().reduce((n, s) => n + s.amount, 0) - spent;
        if (r.mv > total) continue;
        spent += r.mv;
        hand.splice(hand.indexOf(r), 1);
        const from = r.ramp!.kind === "rock" ? turn : turn + 1;
        battlefield.push({ sim: r.ramp!.kind === "land" ? { ...r, land: true, landColors: [...r.ramp!.colors].filter((x): x is Color => x !== "C") } : r, from });
      }
      const landCount = battlefield.filter((b) => b.sim.land).length;
      if (turn === 3) {
        if (landCount >= 3) drop3++;
        const cols = new Set<string>();
        for (const b of battlefield) for (const c of b.sim.land ? b.sim.landColors : [...(b.sim.ramp?.colors ?? [])]) cols.add(c);
        for (const c of deckColors) if (cols.has(c)) color3[c]++;
      }
      if (turn === 4 && landCount >= 4) drop4++;
    }
    if (landsSeen >= 7) flood++;
    cmdCost.forEach((c, k) => {
      const due = Math.max(1, Math.min(c.mv, 8));
      if (cast[k] && cast[k] <= due) onCurve[k]++;
      if (cast[k] && cast[k] <= Math.min(due + 1, 8)) oneLate[k]++;
    });
  }

  const share = (n: number) => Math.round((n / games) * 1000) / 1000;
  return {
    games,
    openingLands: openingLands.map(share),
    keep7: share(keep7),
    freeMulligan: share(free),
    toSixOrFewer: share(six),
    landDrop3: share(drop3),
    landDrop4: share(drop4),
    flood: share(flood),
    colorByTurn3: deckColors.map((c) => ({ color: c, share: share(color3[c]) })),
    commanders: cmdCost.map((c, k) => ({ name: c.name, mv: c.mv, onCurve: share(onCurve[k]), oneLate: share(oneLate[k]) })),
  };
}

/** Which card to put on the bottom first: lands past the fourth, then the most expensive spell. */
function score(c: Sim, hand: Sim[]) {
  const lands = hand.filter((x) => x.land || x.mdfc).length;
  if (c.land || c.mdfc) return lands > 4 ? 100 : -100;
  return c.mv - (c.ramp ? 3 : 0);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Problems worth fixing, in plain words (used by the engine's review and the deck view). */
export function openerProblems(r: OpenerReport): string[] {
  const out: string[] = [];
  if (r.landDrop4 < 0.55) out.push(`Only ${pct(r.landDrop4)} of games hit the fourth land on turn 4: add lands or cheap ramp.`);
  if (r.flood > 0.5) out.push(`${pct(r.flood)} of games see 7+ lands in the first 14 cards: the deck may flood.`);
  for (const c of r.colorByTurn3) if (c.share < 0.7) out.push(`Only ${pct(c.share)} of games have a ${c.color} source by turn 3: add ${c.color} sources.`);
  for (const c of r.commanders) if (c.mv <= 6 && c.oneLate < 0.5) out.push(`${c.name} is cast by turn ${c.mv + 1} in only ${pct(c.oneLate)} of games.`);
  return out;
}

export function openerReport(r: OpenerReport): string {
  const lines = [
    `Opening hands (${r.games} goldfished games): first 7 kept ${pct(r.keep7)}, free mulligan ${pct(r.freeMulligan)}, down to 6 or fewer ${pct(r.toSixOrFewer)}.`,
    `Lands in the first 7: ${r.openingLands.map((s, n) => `${n}: ${pct(s)}`).filter((_, n) => n <= 6).join(", ")}.`,
    `Third land on turn 3: ${pct(r.landDrop3)}; fourth on turn 4: ${pct(r.landDrop4)}; flooding (7+ lands in 14 cards): ${pct(r.flood)}.`,
    `Color by turn 3: ${r.colorByTurn3.map((c) => `${c.color} ${pct(c.share)}`).join(", ")}.`,
    ...r.commanders.map((c) => `${c.name} (MV ${c.mv}): on curve ${pct(c.onCurve)}, by the turn after ${pct(c.oneLate)}.`),
  ];
  const p = openerProblems(r);
  if (p.length) lines.push(`Problems: ${p.join(" ")}`);
  return lines.join("\n");
}

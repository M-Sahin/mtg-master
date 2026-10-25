// Expected value of sealed booster products: what the cards in a pack or box are worth on
// average, after selling costs, and how widely boxes vary. Pure functions, shared by the data
// pipeline (scripts/build-ev.mjs), the Box EV pages and the deck view.
//
// Data: pack layouts and slot ("sheet") odds from taw/magic-sealed-data (the source MTGJSON's
// booster data comes from), card prices from Scryfall (Cardmarket trend, EUR).

export type EvKind = "play" | "collector" | "set" | "draft";

export interface EvCard {
  /** name */ n: string;
  /** set code and collector number */ s: string;
  c: string;
  /** foil */ f: 0 | 1;
  /** price in EUR (Cardmarket trend), null = no price */ p: number | null;
  /** rarity: c u r m s b (special/bonus) */ r?: string;
  /** small image, for the cards that carry the value */ img?: string;
}

export interface EvSheet {
  /** card indexes and their weights */ c: number[];
  w: number[];
  /** total weight */ t: number;
  /** the same card may appear twice in one pack */ dup?: boolean;
}

export interface EvPack {
  w: number; // weight of this pack layout
  s: Record<string, number>; // sheet → cards drawn from it
}

export interface EvProduct {
  id: string; // e.g. "dsk-play"
  name: string; // "Duskmourn: House of Horror Play Booster"
  set: string;
  setName: string;
  released: string; // YYYY-MM-DD
  kind: EvKind;
  packsPerBox: number;
  pricedAt: string; // when prices were fetched (ISO)
  icon?: string; // set symbol SVG
  cards: EvCard[];
  sheets: Record<string, EvSheet>;
  packs: EvPack[];
}

export interface EvSummary {
  id: string;
  name: string;
  set: string;
  setName: string;
  released: string;
  kind: EvKind;
  packsPerBox: number;
  icon?: string;
  /** gross EV per box (EUR, every card at its price) */ grossBox: number;
  /** net EV per box with the default selling assumptions */ netBox: number;
  /** the card with the biggest share of the EV */ topCard?: string;
  /** share of expected cards per pack without a price */ unpriced: number;
}

export interface SellOptions {
  /** marketplace fee on each sale, e.g. 0.05 for Cardmarket's 5% */ fee: number;
  /** cards under this price aren't worth selling: counted as 0 */ cutoff: number;
  /** sell this much under the trend price, e.g. 0.1 = 10% below */ haircut: number;
}

export const DEFAULT_SELL: SellOptions = { fee: 0.05, cutoff: 1, haircut: 0 };
export const PACKS_PER_BOX: Record<EvKind, number> = { play: 36, collector: 12, set: 30, draft: 36 };
export const KIND_LABEL: Record<EvKind, string> = { play: "Play Booster", collector: "Collector Booster", set: "Set Booster", draft: "Draft Booster" };

export const gross = (p: number | null) => p ?? 0;
export function net(p: number | null, o: SellOptions = DEFAULT_SELL): number {
  if (p == null || p < o.cutoff) return 0;
  return p * (1 - o.haircut) * (1 - o.fee);
}

/** Expected copies of each card in one pack (each sheet drawn by weight; duplicates' small effect ignored). */
export function expectedPerPack(prod: EvProduct): Float64Array {
  const out = new Float64Array(prod.cards.length);
  const totalW = prod.packs.reduce((n, p) => n + p.w, 0) || 1;
  for (const pack of prod.packs) {
    const pw = pack.w / totalW;
    for (const [name, count] of Object.entries(pack.s)) {
      const sh = prod.sheets[name];
      if (!sh || !sh.t) continue;
      for (let k = 0; k < sh.c.length; k++) out[sh.c[k]] += (pw * count * sh.w[k]) / sh.t;
    }
  }
  return out;
}

/** Average value of one pack with this valuation. */
export function evPerPack(prod: EvProduct, value: (p: number | null) => number, exp = expectedPerPack(prod)): number {
  let v = 0;
  for (let i = 0; i < prod.cards.length; i++) v += exp[i] * value(prod.cards[i].p);
  return v;
}

/** The cards that carry the value: expected copies per box and their share of the box EV. */
export function topCards(prod: EvProduct, value: (p: number | null) => number, n = 12, packs = prod.packsPerBox, exp = expectedPerPack(prod)) {
  const total = evPerPack(prod, value, exp) || 1;
  return prod.cards
    .map((card, i) => ({ card, perBox: exp[i] * packs, share: (exp[i] * value(card.p)) / total }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.share - a.share)
    .slice(0, n);
}

/** Share of the expected cards per pack that have no price (counted as €0). */
export function unpricedShare(prod: EvProduct, exp = expectedPerPack(prod)): number {
  let all = 0;
  let none = 0;
  for (let i = 0; i < prod.cards.length; i++) {
    all += exp[i];
    if (prod.cards[i].p == null) none += exp[i];
  }
  return all ? none / all : 0;
}

// ---- simulation ------------------------------------------------------------------

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

/** Walker's alias table: weighted picks in constant time. */
function alias(weights: number[]) {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const prob = new Float64Array(n);
  const al = new Int32Array(n);
  const scaled = weights.map((w) => (w * n) / sum);
  const small: number[] = [];
  const large: number[] = [];
  scaled.forEach((p, i) => (p < 1 ? small : large).push(i));
  while (small.length && large.length) {
    const s = small.pop()!;
    const l = large.pop()!;
    prob[s] = scaled[s];
    al[s] = l;
    scaled[l] = scaled[l] + scaled[s] - 1;
    (scaled[l] < 1 ? small : large).push(l);
  }
  for (const i of [...small, ...large]) prob[i] = 1;
  return (r: () => number) => {
    const i = Math.floor(r() * n);
    return r() < prob[i] ? i : al[i];
  };
}

export interface BoxStats {
  boxes: number;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  /** sorted box values, for "chance to reach X" */
  sorted: Float64Array;
}

/** Open `boxes` simulated boxes and value each one. Cards within one sheet draw don't repeat unless the sheet allows it. */
export function simulateBoxes(prod: EvProduct, value: (p: number | null) => number, opts: { boxes?: number; packs?: number; seed?: number } = {}): BoxStats {
  const boxes = opts.boxes ?? 4000;
  const packs = opts.packs ?? prod.packsPerBox;
  const r = rng(opts.seed ?? 12345);
  const values = prod.cards.map((c) => value(c.p));
  const sheets = Object.fromEntries(Object.entries(prod.sheets).map(([k, sh]) => [k, { pick: alias(sh.w), c: sh.c, w: sh.w, dup: !!sh.dup, size: sh.c.length }]));
  // a weighted pick among the cards not drawn yet (when quick retries keep hitting drawn ones)
  const pickUnseen = (sh: { w: number[] }, seen: Set<number>) => {
    let sum = 0;
    for (let i = 0; i < sh.w.length; i++) if (!seen.has(i)) sum += sh.w[i];
    let x = r() * sum;
    for (let i = 0; i < sh.w.length; i++) {
      if (seen.has(i)) continue;
      x -= sh.w[i];
      if (x < 0) return i;
    }
    return sh.w.length - 1;
  };
  const layouts = prod.packs.map((p) => Object.entries(p.s).filter(([k]) => sheets[k]));
  const pickLayout = alias(prod.packs.map((p) => p.w));
  const totals = new Float64Array(boxes);
  const seen = new Set<number>();
  for (let b = 0; b < boxes; b++) {
    let box = 0;
    for (let p = 0; p < packs; p++) {
      for (const [name, count] of layouts[pickLayout(r)]) {
        const sh = sheets[name];
        seen.clear();
        for (let k = 0; k < count; k++) {
          let idx = sh.pick(r);
          // no repeats within a pack's draw from one sheet: a few quick retries, then an exact pick
          if (!sh.dup && seen.size < sh.size) {
            for (let tries = 0; seen.has(idx) && tries < 4; tries++) idx = sh.pick(r);
            if (seen.has(idx)) idx = pickUnseen(sh, seen);
          }
          seen.add(idx);
          box += values[sh.c[idx]];
        }
      }
    }
    totals[b] = box;
  }
  const sorted = totals.slice().sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { boxes, mean: totals.reduce((a, b) => a + b, 0) / boxes, p10: at(0.1), p50: at(0.5), p90: at(0.9), sorted };
}

/** Share of simulated boxes worth at least `x`. */
export function chanceAtLeast(stats: BoxStats, x: number): number {
  const s = stats.sorted;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return (s.length - lo) / s.length;
}

/** The index row for a product, with the default selling assumptions. */
export function summarize(prod: EvProduct): EvSummary {
  const exp = expectedPerPack(prod);
  const top = topCards(prod, gross, 1, prod.packsPerBox, exp)[0];
  return {
    id: prod.id,
    name: prod.name,
    set: prod.set,
    setName: prod.setName,
    released: prod.released,
    kind: prod.kind,
    packsPerBox: prod.packsPerBox,
    ...(prod.icon ? { icon: prod.icon } : {}),
    grossBox: round2(evPerPack(prod, gross, exp) * prod.packsPerBox),
    netBox: round2(evPerPack(prod, (p) => net(p), exp) * prod.packsPerBox),
    ...(top ? { topCard: top.card.n } : {}),
    unpriced: Math.round(unpricedShare(prod, exp) * 1000) / 1000,
  };
}

export const round2 = (x: number) => Math.round(x * 100) / 100;

// ---- singles or boxes? ------------------------------------------------------------

/** names index: which products a card can come from, and the expected copies per box. */
export interface EvNames {
  products: { id: string; name: string; kind: EvKind; packsPerBox: number; grossBox: number; released: string }[];
  /** front-face key (see nameKey) → [product index, expected copies per box][] */
  names: Record<string, [number, number][]>;
}

/** Expected copies per box of every card name in a product (all printings and finishes together). */
export function namesPerBox(prod: EvProduct, key: (n: string) => string): Map<string, number> {
  const exp = expectedPerPack(prod);
  const out = new Map<string, number>();
  prod.cards.forEach((c, i) => {
    const k = key(c.n);
    out.set(k, (out.get(k) ?? 0) + exp[i] * prod.packsPerBox);
  });
  return out;
}

export interface DeckBoxRow {
  product: EvNames["products"][number];
  /** the deck's cards this box can contain */ cards: { name: string; perBox: number; price: number | null }[];
  /** expected value of the deck's cards you'd actually use from one box: each card at most once */ deckValue: number;
  /** what those cards cost as singles */ singles: number;
}

/**
 * For a deck: per product, the deck cards a box can give, the expected value of the ones you'd
 * use (a card counts once: P(at least one) = 1 − e^(−copies per box)), and their singles price.
 */
export function deckBoxes(index: EvNames, deck: { name: string; price: number | null }[], key: (n: string) => string, limit = 5): DeckBoxRow[] {
  const rows = new Map<number, DeckBoxRow>();
  for (const card of deck) {
    for (const [pi, perBox] of index.names[key(card.name)] ?? []) {
      const product = index.products[pi];
      if (!product) continue;
      const row = rows.get(pi) ?? { product, cards: [], deckValue: 0, singles: 0 };
      row.cards.push({ name: card.name, perBox, price: card.price });
      row.deckValue += (1 - Math.exp(-perBox)) * (card.price ?? 0);
      row.singles += card.price ?? 0;
      rows.set(pi, row);
    }
  }
  return [...rows.values()]
    .filter((r) => r.singles > 0)
    .sort((a, b) => b.deckValue - a.deckValue || b.cards.length - a.cards.length)
    .slice(0, limit)
    .map((r) => ({ ...r, deckValue: round2(r.deckValue), singles: round2(r.singles), cards: r.cards.sort((a, b) => (b.price ?? 0) - (a.price ?? 0)) }));
}

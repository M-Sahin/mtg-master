// The opening-hand check: goldfished numbers must move the right way when the mana changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canPay, openerProblems, openerReport, simulateOpeners } from "../lib/shared/openers";
import type { CardInfo, Color, Deck, DeckCard } from "../lib/shared/types";

function info(name: string, typeLine: string, manaCost: string, cmc: number, text = "", extra: Partial<CardInfo> = {}): CardInfo {
  return {
    name, manaCost, cmc, typeLine, oracleText: text, colorIdentity: [], legalCommander: "legal", canBeCommander: false, gameChanger: false,
    priceEur: 1, priceUsd: 1, image: null, artCrop: null, artist: null, scryfallUri: "", edhrecRank: null, producedMana: [], ...extra,
  };
}
const basic = (name: string, c: Color, qty: number): DeckCard => ({ name, role: "land", why: "", qty, info: info(name, "Basic Land — " + name, "", 0, `({T}: Add {${c}}.)`, { producedMana: [c] }) });
const spell = (k: number, cost: string, cmc: number): DeckCard => ({ name: `Spell ${k}`, role: "synergy", why: "", qty: 1, info: info(`Spell ${k}`, "Creature — Bear", cost, cmc) });
const rock = (k: number): DeckCard => ({ name: `Signet ${k}`, role: "ramp", why: "", qty: 1, info: info(`Signet ${k}`, "Artifact", "{2}", 2, "{T}: Add {C}.", { producedMana: ["C"] }) });

function deck(lands: DeckCard[], spells: number, opts: { rocks?: number; cost?: string } = {}): Deck {
  const landN = lands.reduce((n, c) => n + c.qty, 0);
  const rocks = opts.rocks ?? 0;
  const cards = [...lands, ...Array.from({ length: rocks }, (_, k) => rock(k)), ...Array.from({ length: 99 - landN - rocks }, (_, k) => spell(k, "{2}{B}", 3))];
  assert.equal(cards.reduce((n, c) => n + c.qty, 0), 99);
  return {
    name: "t", strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"], cards,
    commander: { name: "Meren", role: "synergy", why: "", qty: 1, info: info("Meren", "Legendary Creature", opts.cost ?? "{2}{B}{G}", 4) },
  };
}

test("canPay: colors come from sources that make them, the scarcest first", () => {
  const src = (c: string[], n = 1) => ({ colors: new Set<any>(c), amount: n });
  assert.equal(canPay([src(["B"]), src(["G"]), src(["C"], 2)], { W: 0, U: 0, B: 1, R: 0, G: 1 }, 4), true);
  assert.equal(canPay([src(["B"]), src(["B"]), src(["C"], 2)], { W: 0, U: 0, B: 1, R: 0, G: 1 }, 4), false);
  // the dual must be saved for green
  assert.equal(canPay([src(["B", "G"]), src(["B"]), src(["C"])], { W: 0, U: 0, B: 1, R: 0, G: 1 }, 3), true);
  assert.equal(canPay([src(["B"]), src(["G"])], { W: 0, U: 0, B: 1, R: 0, G: 1 }, 3), false);
});

test("simulateOpeners: deterministic, and more lands means more fourth land drops", () => {
  const good = deck([basic("Swamp", "B", 19), basic("Forest", "G", 18)], 62);
  const few = deck([basic("Swamp", "B", 14), basic("Forest", "G", 13)], 72);
  const a = simulateOpeners(good, { games: 2000 });
  assert.deepEqual(a, simulateOpeners(good, { games: 2000 }), "same deck, same numbers");
  const b = simulateOpeners(few, { games: 2000 });
  assert.ok(a.landDrop4 > b.landDrop4 + 0.1, `${a.landDrop4} vs ${b.landDrop4}`);
  assert.ok(a.landDrop4 > 0.7 && a.landDrop4 < 0.97, `37 lands: ${a.landDrop4}`);
  assert.ok(Math.abs(a.openingLands.reduce((n, x) => n + x, 0) - 1) < 0.01);
  assert.ok(a.keep7 + a.freeMulligan + a.toSixOrFewer > 0.99);
  // 37 lands and only 3-drops: keeping needs 3–5 lands, about 54% of 7-card hands
  assert.ok(a.keep7 > 0.48 && a.keep7 < 0.6, `keep7 ${a.keep7}`);
  assert.ok(a.keep7 + a.freeMulligan > 0.75, "the free mulligan fixes most of the rest");
  assert.ok(a.commanders[0].oneLate > 0.7, `Meren by turn 5: ${a.commanders[0].oneLate}`);
  assert.ok(b.commanders[0].oneLate < a.commanders[0].oneLate);
});

test("simulateOpeners: a skewed mana base shows up as a missing color", () => {
  const skew = deck([basic("Swamp", "B", 33), basic("Forest", "G", 4)], 62);
  const r = simulateOpeners(skew, { games: 2000 });
  const g = r.colorByTurn3.find((c) => c.color === "G")!.share;
  assert.ok(g < 0.5, `green by turn 3: ${g}`);
  assert.ok(r.commanders[0].oneLate < 0.5, `Meren needs green: ${r.commanders[0].oneLate}`);
  const p = openerProblems(r);
  assert.ok(p.some((x) => /G source/.test(x)), p.join(" | "));
  assert.match(openerReport(r), /Color by turn 3: B \d+%, G \d+%/);
});

test("simulateOpeners: mana rocks help cast the commander on curve", () => {
  const plain = simulateOpeners(deck([basic("Swamp", "B", 17), basic("Forest", "G", 17)], 65, { cost: "{4}{B}{G}" }), { games: 2000 });
  const rocks = simulateOpeners(deck([basic("Swamp", "B", 17), basic("Forest", "G", 17)], 55, { rocks: 10, cost: "{4}{B}{G}" }), { games: 2000 });
  assert.ok(rocks.commanders[0].onCurve > plain.commanders[0].onCurve + 0.05, `${rocks.commanders[0].onCurve} vs ${plain.commanders[0].onCurve}`);
});

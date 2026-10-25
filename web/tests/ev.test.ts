// Box EV math: expected values by hand, the simulation agrees with them, selling costs apply per card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chanceAtLeast, deckBoxes, evPerPack, expectedPerPack, gross, namesPerBox, net, simulateBoxes, summarize, topCards, unpricedShare, type EvNames, type EvProduct } from "../lib/shared/ev";
import { nameKey } from "../lib/shared/types";

// one pack = 2 commons (no repeats) + 1 rare slot; 1 in 4 packs has a foil chase instead of a common
function product(): EvProduct {
  const cards = [
    { n: "Common A", s: "tst", c: "1", f: 0 as const, p: 0.1 },
    { n: "Common B", s: "tst", c: "2", f: 0 as const, p: 0.2 },
    { n: "Common C", s: "tst", c: "3", f: 0 as const, p: null },
    { n: "Rare X", s: "tst", c: "4", f: 0 as const, p: 2 },
    { n: "Mythic Y", s: "tst", c: "5", f: 0 as const, p: 20 },
    { n: "Mythic Y", s: "tst", c: "5", f: 1 as const, p: 60 },
  ];
  return {
    id: "tst-play", name: "Test Play Booster", set: "tst", setName: "Test", released: "2026-01-01", kind: "play", packsPerBox: 10, pricedAt: "2026-10-25",
    cards,
    sheets: {
      common: { c: [0, 1, 2], w: [1, 1, 1], t: 3 },
      rare: { c: [3, 4], w: [7, 1], t: 8 },
      foil: { c: [5], w: [1], t: 1 },
    },
    packs: [
      { w: 3, s: { common: 2, rare: 1 } },
      { w: 1, s: { common: 1, rare: 1, foil: 1 } },
    ],
  };
}

test("expected copies and EV per pack match the hand calculation", () => {
  const p = product();
  const e = expectedPerPack(p);
  // commons: (3/4·2 + 1/4·1) / 3 each = 1.75/3
  assert.ok(Math.abs(e[0] - 1.75 / 3) < 1e-12);
  assert.ok(Math.abs(e[3] - 7 / 8) < 1e-12);
  assert.ok(Math.abs(e[5] - 0.25) < 1e-12);
  // gross: commons 1.75/3·(0.1+0.2+0) + rare 7/8·2 + 1/8·20 + 1/4·60
  const want = (1.75 / 3) * 0.3 + 1.75 + 2.5 + 15;
  assert.ok(Math.abs(evPerPack(p, gross) - want) < 1e-9);
  // net: cards under €1 count 0, 5% fee on the rest
  const wantNet = (1.75 + 2.5 + 15) * 0.95;
  assert.ok(Math.abs(evPerPack(p, (x) => net(x)) - wantNet) < 1e-9);
  assert.equal(net(0.99), 0);
  assert.equal(net(10, { fee: 0.05, cutoff: 1, haircut: 0.1 }), 10 * 0.9 * 0.95);
  assert.ok(Math.abs(unpricedShare(p) - (1.75 / 3) / (1.75 + 1 + 0.25)) < 1e-9);
});

test("simulated boxes average out to the EV and give a spread", () => {
  const p = product();
  const s = simulateBoxes(p, gross, { boxes: 20000 });
  const ev = evPerPack(p, gross) * p.packsPerBox;
  assert.ok(Math.abs(s.mean - ev) / ev < 0.02, `${s.mean} vs ${ev}`);
  assert.ok(s.p10 < s.p50 && s.p50 < s.p90);
  assert.equal(chanceAtLeast(s, -1), 1);
  assert.equal(chanceAtLeast(s, 1e9), 0);
  const half = chanceAtLeast(s, s.p50);
  assert.ok(half > 0.45 && half < 0.6, String(half));
  assert.deepEqual(simulateBoxes(p, gross, { boxes: 500, seed: 7 }).sorted, simulateBoxes(p, gross, { boxes: 500, seed: 7 }).sorted, "seeded: same boxes");
});

test("no repeats within one sheet draw, unless the sheet allows them", () => {
  // two cards drawn from a two-card sheet: always one of each
  const p: EvProduct = { ...product(), cards: [{ n: "A", s: "t", c: "1", f: 0, p: 1 }, { n: "B", s: "t", c: "2", f: 0, p: 100 }], sheets: { s: { c: [0, 1], w: [99, 1], t: 100 } }, packs: [{ w: 1, s: { s: 2 } }], packsPerBox: 1 };
  const s = simulateBoxes(p, gross, { boxes: 300 });
  assert.equal(s.p10, 101);
  assert.equal(s.p90, 101);
  const dup = simulateBoxes({ ...p, sheets: { s: { ...p.sheets.s, dup: true } } }, gross, { boxes: 300 });
  assert.ok(dup.p10 < 101, "with repeats allowed, A+A happens");
});

test("top cards and the summary row", () => {
  const p = product();
  const top = topCards(p, gross, 3);
  assert.deepEqual(top.map((t) => `${t.card.n}${t.card.f ? " (foil)" : ""}`), ["Mythic Y (foil)", "Mythic Y", "Rare X"]);
  assert.ok(Math.abs(top[0].perBox - 2.5) < 1e-9, "a quarter of 10 packs");
  const s = summarize(p);
  assert.equal(s.topCard, "Mythic Y");
  assert.equal(s.grossBox, Math.round(evPerPack(p, gross) * 10 * 100) / 100);
  assert.ok(s.netBox < s.grossBox);
});

test("singles or boxes: the deck's cards a box can give, each counted once", () => {
  const p = product();
  const per = namesPerBox(p, nameKey);
  assert.ok(Math.abs(per.get("mythic y")! - (1 / 8 + 1 / 4) * 10) < 1e-9, "both finishes together");
  const index: EvNames = { products: [{ id: p.id, name: p.name, kind: p.kind, packsPerBox: 10, grossBox: 100, released: p.released }], names: Object.fromEntries([...per].map(([k, v]) => [k, [[0, v]]])) };
  const rows = deckBoxes(index, [{ name: "Mythic Y", price: 20 }, { name: "Rare X", price: 2 }, { name: "Sol Ring", price: 1.5 }], nameKey);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].singles, 22);
  const want = (1 - Math.exp(-3.75)) * 20 + (1 - Math.exp(-8.75)) * 2;
  assert.ok(Math.abs(rows[0].deckValue - want) < 0.01);
  assert.deepEqual(rows[0].cards.map((c) => c.name), ["Mythic Y", "Rare X"]);
});

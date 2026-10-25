// Bracket checker: decklist parsing, the bracket rules, and the whole check on fixture cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBracket, estimateBracket, handleBracketCheck } from "../lib/server/bracket-check";
import { resetComboCache } from "../lib/server/combos";
import { DEMO_SUBMISSION } from "../lib/server/demo";
import { parseDecklist } from "../lib/shared/decklist";
import { installFakeScryfall, spellbook } from "./fixtures";

test("decklists: Arena sections, Moxfield/plain blocks, Archidekt markers, sideboards skipped", () => {
  const arena = parseDecklist("Commander\n1 Meren of Clan Nel Toth (C15) 49\n\nDeck\n1 Sol Ring\n10 Forest\n\nSideboard\n1 Plaguecrafter");
  assert.deepEqual(arena.commanders, ["Meren of Clan Nel Toth"]);
  assert.deepEqual(arena.cards, [{ name: "Sol Ring", qty: 1 }, { name: "Forest", qty: 10 }]);
  assert.equal(arena.skipped, 1);
  const plain = parseDecklist("1 Meren of Clan Nel Toth\n\n1 Sol Ring\n1x Arcane Signet (CMR) 297 *F*\n9 Swamp");
  assert.deepEqual(plain.commanders, []);
  assert.deepEqual(plain.commanderGuess, ["Meren of Clan Nel Toth"]);
  const archidekt = parseDecklist("1x Meren of Clan Nel Toth (c15) 49 [Commander{top}]\n1x Sol Ring (cmr) 1 [Ramp]");
  assert.deepEqual(archidekt.commanders, ["Meren of Clan Nel Toth"]);
  assert.deepEqual(archidekt.cards, [{ name: "Sol Ring", qty: 1 }]);
  const mtgo = parseDecklist("1 Sol Ring\n1 Sol Ring\n1 Kenrith, the Returned King *CMDR*");
  assert.deepEqual(mtgo.cards, [{ name: "Sol Ring", qty: 2 }], "duplicate lines merge");
  assert.deepEqual(mtgo.commanders, ["Kenrith, the Returned King"]);
});

test("the bracket rules", () => {
  const none = { gameChangers: [], massLandDenial: [], extraTurns: [], earlyCombos: [], otherCombos: [] };
  assert.equal(estimateBracket(none).bracket, 2);
  assert.equal(estimateBracket({ ...none, extraTurns: ["Time Warp"] }).bracket, 2);
  assert.equal(estimateBracket({ ...none, gameChangers: ["a", "b", "c"] }).bracket, 3);
  assert.equal(estimateBracket({ ...none, gameChangers: ["a", "b", "c", "d"] }).bracket, 4);
  assert.equal(estimateBracket({ ...none, massLandDenial: ["Armageddon"] }).bracket, 4);
  assert.equal(estimateBracket({ ...none, extraTurns: ["a", "b", "c"] }).bracket, 4);
  const combo = (tag: string) => ({ id: "1", cards: ["A", "B"], results: ["Infinite mana"], bracketTag: tag, url: "" });
  assert.equal(estimateBracket({ ...none, otherCombos: [combo("S")] }).bracket, 3);
  const r = estimateBracket({ ...none, gameChangers: ["x"], earlyCombos: [combo("R")] });
  assert.equal(r.bracket, 4);
  assert.equal(r.reasons[0].bracket, 4, "the strongest reason comes first");
});

test("checking the demo deck: commander found, Game Changers and combos counted, legal", async () => {
  const fake = installFakeScryfall();
  resetComboCache();
  spellbook.body = { results: { included: [{ id: "1-2", uses: [{ card: { name: "Sol Ring" } }, { card: { name: "Ashnod's Altar" } }], produces: [{ feature: { name: "Infinite mana" } }], bracketTag: "R" }] } };
  try {
    const lines = ["1 Meren of Clan Nel Toth", ""];
    for (const c of DEMO_SUBMISSION.cards) lines.push(`1 ${c.name}`);
    for (const [b, q] of Object.entries(DEMO_SUBMISSION.basics ?? {})) lines.push(`${q} ${b}`);
    lines.push("1 Demonic Tutor"); // fixture Game Changer (makes 101: a size problem to report)
    const r = await checkBracket(lines.join("\n"));
    assert.deepEqual(r.commanders, ["Meren of Clan Nel Toth"]);
    assert.equal(r.commanderGuessed, true);
    assert.deepEqual(r.gameChangers, ["Demonic Tutor"]);
    assert.equal(r.bracket, 4, "an early two-card combo makes it bracket 4");
    assert.equal(r.combos.early.length, 1);
    assert.equal(r.total, 101);
    assert.ok(r.problems.some((p) => /101/.test(p)));
    assert.ok(!r.problems.some((p) => /Game Changers/.test(p)), "the Game Changer cap isn't a legality problem here");
    assert.ok(r.analysis && r.analysis.lands > 30);
  } finally {
    spellbook.body = { results: { included: [] } };
    fake.restore();
  }
});

test("bracket API: empty lists and oversized requests are refused", async () => {
  const empty = await handleBracketCheck(new Request("http://x/api/bracket", { method: "POST", body: JSON.stringify({ list: "  " }) }));
  assert.equal(empty.status, 400);
  const big = await handleBracketCheck(new Request("http://x/api/bracket", { method: "POST", headers: { "content-length": "70000" }, body: "{}" }));
  assert.equal(big.status, 413);
});

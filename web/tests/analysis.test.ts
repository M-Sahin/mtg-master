// The objective analysis must recognise what real cards do (Oracle text as on Scryfall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDeck, detectFunctions, entersTapped, landColors, pips, sourceTarget } from "../lib/shared/analysis";
import type { CardInfo, Color, Deck, DeckCard } from "../lib/shared/types";

function card(name: string, typeLine: string, manaCost: string, text: string, extra: Partial<CardInfo> = {}): CardInfo {
  const cmc = (manaCost.match(/\{[^}]+\}/g) ?? []).reduce((n, s) => n + (/^\{\d+\}$/.test(s) ? Number(s.slice(1, -1)) : /X/.test(s) ? 0 : 1), 0);
  return {
    name, manaCost, cmc, typeLine, oracleText: text, colorIdentity: [], legalCommander: "legal", canBeCommander: false, gameChanger: false,
    priceEur: 1, priceUsd: 1, image: null, artCrop: null, artist: null, scryfallUri: "", edhrecRank: null, producedMana: [], ...extra,
  };
}

const CARDS: [CardInfo, string[]][] = [
  [card("Sol Ring", "Artifact", "{1}", "{T}: Add {C}{C}.", { edhrecRank: 1 }), ["ramp"]],
  [card("Llanowar Elves", "Creature — Elf Druid", "{G}", "{T}: Add {G}."), ["ramp"]],
  [card("Cultivate", "Sorcery", "{2}{G}", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle."), ["ramp"]],
  [card("Rampant Growth", "Sorcery", "{1}{G}", "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle."), ["ramp"]],
  [card("Nature's Lore", "Sorcery", "{1}{G}", "Search your library for a Forest card, put that card onto the battlefield, then shuffle."), ["ramp"]],
  [card("Dark Ritual", "Instant", "{B}", "Add {B}{B}{B}."), []],
  [card("Harmonize", "Sorcery", "{2}{G}{G}", "Draw three cards."), ["draw"]],
  [card("Phyrexian Arena", "Enchantment", "{1}{B}{B}", "At the beginning of your upkeep, you draw a card and you lose 1 life."), ["draw"]],
  [card("Grim Haruspex", "Creature — Human Wizard", "{2}{B}", "Morph {B}\nWhenever another nontoken creature you control dies, draw a card."), ["draw"]],
  [card("Tireless Tracker", "Creature — Human Scout", "{2}{G}", "Whenever a land you control enters, investigate.\nWhenever you sacrifice a Clue, put a +1/+1 counter on this creature."), ["draw"]],
  [card("Deadly Dispute", "Instant", "{1}{B}", "As an additional cost to cast this spell, sacrifice an artifact or creature.\nDraw two cards and create a Treasure token."), ["draw", "ramp"]],
  [card("Swords to Plowshares", "Instant", "{W}", "Exile target creature. Its controller gains life equal to its power."), ["removal"]],
  [card("Beast Within", "Instant", "{2}{G}", "Destroy target permanent. Its controller creates a 3/3 green Beast creature token."), ["removal"]],
  [card("Counterspell", "Instant", "{U}{U}", "Counter target spell."), ["removal"]],
  [card("Fleshbag Marauder", "Creature — Zombie Warrior", "{2}{B}", "When this creature enters, each player sacrifices a creature of their choice."), ["removal"]],
  [card("Cyclonic Rift", "Instant", "{1}{U}", "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of \"target\" with \"each.\")"), ["removal"]],
  [card("Wrath of God", "Sorcery", "{2}{W}{W}", "Destroy all creatures. They can't be regenerated."), ["wipe"]],
  [card("Blasphemous Act", "Sorcery", "{8}{R}", "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature."), ["wipe"]],
  [card("Toxic Deluge", "Sorcery", "{2}{B}", "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn."), ["wipe"]],
  [card("Lightning Greaves", "Artifact — Equipment", "{2}", "Equipped creature has haste and shroud.\nEquip {0}"), ["protection"]],
  [card("Heroic Intervention", "Instant", "{1}{G}", "Permanents you control gain hexproof and indestructible until end of turn."), ["protection"]],
  [card("Eternal Witness", "Creature — Human Shaman", "{1}{G}{G}", "When this creature enters, return target card from your graveyard to your hand."), ["recursion"]],
  [card("Demonic Tutor", "Sorcery", "{1}{B}", "Search your library for a card, put that card into your hand, then shuffle."), ["tutor"]],
  [card("Viscera Seer", "Creature — Vampire Wizard", "{B}", "Sacrifice a creature: Scry 1."), []],
];

for (const [c, want] of CARDS) {
  test(`detects ${c.name}: ${want.join(", ") || "nothing"}`, () => {
    assert.deepEqual([...detectFunctions(c)].sort(), [...want].sort());
  });
}

test("pips: hybrid and Phyrexian count half; front face only", () => {
  assert.deepEqual(pips("{1}{G}{G}"), { W: 0, U: 0, B: 0, R: 0, G: 2 });
  assert.deepEqual(pips("{2}{B/G}{B/G}"), { W: 0, U: 0, B: 1, R: 0, G: 1 });
  assert.equal(pips("{G/P}").G, 0.5);
  assert.equal(pips("{R} // {3}{U}").U, 0);
});

test("source targets follow the 99-card table", () => {
  assert.equal(sourceTarget(1, 1), 19);
  assert.equal(sourceTarget(1, 4), 16);
  assert.equal(sourceTarget(2, 2), 30);
  assert.equal(sourceTarget(2, 3), 28);
  assert.equal(sourceTarget(3, 3), 36);
  assert.equal(sourceTarget(0, 5), 0);
});

test("lands: tapped, conditional, fetch colors", () => {
  const hollow = card("Jungle Hollow", "Land", "", "This land enters tapped.\nWhen this land enters, you gain 1 life.\n{T}: Add {B} or {G}.", { producedMana: ["B", "G"] });
  const cemetery = card("Woodland Cemetery", "Land", "", "This land enters tapped unless you control a Swamp or a Forest.\n{T}: Add {B} or {G}.", { producedMana: ["B", "G"] });
  const tomb = card("Overgrown Tomb", "Land — Swamp Forest", "", "({T}: Add {B} or {G}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.", { producedMana: ["B", "G"] });
  const wilds = card("Evolving Wilds", "Land", "", "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.");
  const tower = card("Command Tower", "Land", "", "{T}: Add one mana of any color in your commander's color identity.", { producedMana: ["W", "U", "B", "R", "G"] });
  assert.equal(entersTapped(hollow), "tapped");
  assert.equal(entersTapped(cemetery), "conditional");
  assert.equal(entersTapped(tomb), "conditional");
  const deckColors: Color[] = ["B", "G"];
  assert.deepEqual(landColors(wilds, deckColors, new Set<Color>(["B", "G"])).sort(), ["B", "G"]);
  assert.deepEqual(landColors(tower, deckColors, new Set()).sort(), ["B", "G"]);
  assert.deepEqual(landColors(tomb, deckColors, new Set()).sort(), ["B", "G"]);
});

test("analyzeDeck counts real functions, sources, curve, staples and price", () => {
  const dc = (info: CardInfo, role: DeckCard["role"], qty = 1): DeckCard => ({ name: info.name, qty, role, why: "", info });
  const byName = Object.fromEntries(CARDS.map(([c]) => [c.name, c]));
  const meren = card("Meren of Clan Nel Toth", "Legendary Creature — Human Shaman", "{2}{B}{G}", "Whenever another creature you control dies, you get an experience counter.", { colorIdentity: ["B", "G"], canBeCommander: true });
  const mdfc = card("Bala Ged Recovery // Bala Ged Sanctuary", "Sorcery // Land", "{2}{G}", "[Bala Ged Recovery] {2}{G} — Sorcery\nReturn target card from your graveyard to your hand.\n[Bala Ged Sanctuary]  — Land\nAs this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {G}.", { producedMana: ["G"] });
  const tomb = card("Overgrown Tomb", "Land — Swamp Forest", "", "As this land enters, you may pay 2 life. If you don't, it enters tapped.", { producedMana: ["B", "G"], priceEur: 12 });
  const forest = card("Forest", "Basic Land — Forest", "", "({T}: Add {G}.)", { producedMana: ["G"], priceEur: 0.1 });
  const swamp = card("Swamp", "Basic Land — Swamp", "", "({T}: Add {B}.)", { producedMana: ["B"], priceEur: 0.1 });
  const deck: Deck = {
    name: "t", commander: dc(meren, "wincon"), strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"],
    cards: [
      dc(byName["Sol Ring"], "ramp"), dc(byName["Cultivate"], "ramp"), dc(byName["Harmonize"], "draw"), dc(byName["Phyrexian Arena"], "draw"),
      dc(byName["Viscera Seer"], "ramp"), // wrong tag on purpose
      dc(byName["Eternal Witness"], "recursion"), dc(byName["Toxic Deluge"], "wipe"), dc(mdfc, "recursion"),
      dc(tomb, "land"), dc(forest, "land", 10), dc(swamp, "land", 8),
    ],
  };
  const a = analyzeDeck(deck, { budget: "budget", seeds: ["Viscera Seer"] });
  assert.equal(a.lands, 19);
  assert.equal(a.mdfcLands, 1);
  assert.equal(a.counts.ramp, 2);
  assert.equal(a.counts.draw, 2);
  assert.equal(a.counts.wipe, 1);
  assert.equal(a.counts.recursion, 2);
  assert.deepEqual(a.unverifiedTags, [{ name: "Viscera Seer", role: "ramp" }]);
  const g = a.colors.find((c) => c.color === "G")!;
  const b = a.colors.find((c) => c.color === "B")!;
  assert.equal(g.sources, 12); // 10 Forest + Tomb + MDFC back
  assert.equal(b.sources, 9);
  assert.equal(g.target, 28); // Eternal Witness {1}{G}{G}
  assert.equal(g.hardest, "Eternal Witness");
  assert.deepEqual(a.staples, ["Sol Ring"]);
  assert.equal(a.curve[1], 2); // Sol Ring, Viscera Seer
  assert.equal(a.budgetCapEur, 75);
  assert.ok(a.priceEur > 12 && a.priceEur < 25);
});

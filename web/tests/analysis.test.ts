// The objective analysis must recognise what real cards do (Oracle text as on Scryfall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDeck, detectFunctions, entersTapped, isMdfcLand, landColors, pips, sourceTarget } from "../lib/shared/analysis";
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
  [card("Cyclonic Rift", "Instant", "{1}{U}", "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of \"target\" with \"each.\")"), ["removal", "wipe"]],
  // wipes the Scryfall Tagger calibration found missing
  [card("Organic Extinction", "Sorcery", "{8}{W}{W}", "Improvise\nDestroy all nonartifact creatures."), ["wipe"]],
  [card("Culling Ritual", "Sorcery", "{2}{B}{G}", "Destroy each nonland permanent with mana value 2 or less. Add {B} or {G} for each permanent destroyed this way."), ["wipe"]],
  [card("Massacre Wurm", "Creature — Phyrexian Wurm", "{3}{B}{B}{B}", "When this creature enters, creatures your opponents control get -2/-2 until end of turn.\nWhenever a creature an opponent controls dies, that player loses 2 life."), ["wipe"]],
  [card("Chandra's Ignition", "Sorcery", "{3}{R}{R}", "Target creature you control deals damage equal to its power to each other creature and each opponent."), ["wipe"]],
  [card("Aetherize", "Instant", "{3}{U}", "Return all attacking creatures to their owner's hand."), ["wipe"]],
  [card("All Is Dust", "Kindred Sorcery — Eldrazi", "{7}", "Each player sacrifices all permanents they control that are one or more colors."), ["wipe"]],
  [card("Wrath of God", "Sorcery", "{2}{W}{W}", "Destroy all creatures. They can't be regenerated."), ["wipe"]],
  [card("Blasphemous Act", "Sorcery", "{8}{R}", "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature."), ["wipe"]],
  [card("Toxic Deluge", "Sorcery", "{2}{B}", "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn."), ["wipe"]],
  [card("Lightning Greaves", "Artifact — Equipment", "{2}", "Equipped creature has haste and shroud.\nEquip {0}"), ["protection"]],
  [card("Heroic Intervention", "Instant", "{1}{G}", "Permanents you control gain hexproof and indestructible until end of turn."), ["protection"]],
  [card("Eternal Witness", "Creature — Human Shaman", "{1}{G}{G}", "When this creature enters, return target card from your graveyard to your hand."), ["recursion"]],
  [card("Demonic Tutor", "Sorcery", "{1}{B}", "Search your library for a card, put that card into your hand, then shuffle."), ["tutor"]],
  [card("Viscera Seer", "Creature — Vampire Wizard", "{B}", "Sacrifice a creature: Scry 1."), []],
  // misses found by calibrating on the demo deck in CI
  [card("Go for the Throat", "Instant", "{1}{B}", "Destroy target nonartifact creature."), ["removal"]],
  [card("Living Death", "Sorcery", "{3}{B}{B}", "Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield."), ["wipe"]],
  [card("Animate Dead", "Enchantment — Aura", "{1}{B}", "Enchant creature card in a graveyard\nWhen this Aura enters, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with this Aura.\" Return enchanted creature card to the battlefield under your control and attach this Aura to it. Enchanted creature gets -1/-0."), ["recursion"]],
  [card("Victimize", "Sorcery", "{2}{B}", "Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped."), ["recursion"]],
  [card("Doom Blade", "Instant", "{1}{B}", "Destroy target nonblack creature."), ["removal"]],
  [card("Vindicate", "Sorcery", "{1}{W}{B}", "Destroy target permanent."), ["removal"]],
  // from the code review: real wording the first patterns missed or over-counted
  [card("Ultimate Price", "Instant", "{1}{B}", "Destroy target monocolored creature."), ["removal"]],
  [card("Rabid Bite", "Sorcery", "{1}{G}", "Target creature you control deals damage equal to its power to target creature you don't control."), ["removal"]],
  [card("Ram Through", "Sorcery", "{1}{G}", "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control. If the creature you control has trample, excess damage is dealt to that permanent's controller instead."), ["removal"]],
  [card("Swan Song", "Instant", "{U}", "Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying."), ["removal"]],
  [card("Chaos Warp", "Instant", "{2}{R}", "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they may put it onto the battlefield."), ["removal"]],
  [card("Wheel of Fortune", "Sorcery", "{2}{R}", "Each player discards their hand, then draws seven cards."), ["draw"]],
  [card("Windfall", "Sorcery", "{2}{U}", "Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way."), ["draw"]],
  [card("Old Gnawbone", "Legendary Creature — Dragon", "{5}{G}{G}", "Flying\nWhenever a creature you control deals combat damage to a player, create that many Treasure tokens."), ["ramp"]],
  [card("Tireless Provisioner", "Creature — Elf Scout", "{2}{G}", "Landfall — Whenever a land you control enters, create a Food token or a Treasure token."), ["ramp"]],
  [card("Ephemerate", "Instant", "{W}", "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound"), []],
  [card("Laboratory Maniac", "Creature — Human Wizard", "{2}{U}", "If you would draw a card while your library has no cards in it, you win the game instead."), []],
  [card("Kazandu Mammoth // Kazandu Valley", "Creature — Elephant // Land", "{1}{G}{G} // ", "[Kazandu Mammoth] {1}{G}{G} — Creature — Elephant\nLandfall — Whenever a land you control enters, Kazandu Mammoth gets +2/+2 until end of turn.\n[Kazandu Valley]  — Land\nKazandu Valley enters tapped.\n{T}: Add {G}.", { layout: "modal_dfc", producedMana: ["G"] }), []],
  [card("Scavenging Ooze", "Creature — Ooze", "{1}{G}", "{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life."), []],
];

for (const [c, want] of CARDS) {
  test(`detects ${c.name}: ${want.join(", ") || "nothing"}`, () => {
    assert.deepEqual([...detectFunctions(c)].sort(), [...want].sort());
  });
}

test("MDFC vs transforming double-faced cards", () => {
  const mdfc = card("Kazandu Mammoth // Kazandu Valley", "Creature — Elephant // Land", "{1}{G}{G}", "", { layout: "modal_dfc" });
  const azcanta = card("Search for Azcanta // Azcanta, the Sunken Ruin", "Legendary Enchantment // Legendary Land", "{1}{U}", "", { layout: "transform" });
  assert.equal(isMdfcLand(mdfc), true);
  assert.equal(isMdfcLand(azcanta), false);
});

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

test("win conditions that slipped into the strategy text are taken back out", async () => {
  const { untangleText } = await import("../lib/server/validate");
  assert.deepEqual(untangleText('Spells make tokens. ", "win_conditions": ["Shark late for X.", "Hermes makes Birds."]', []), { strategy: "Spells make tokens.", winConditions: ["Shark late for X.", "Hermes makes Birds."] });
  assert.deepEqual(untangleText("Plain text.", '["Drain with Blood Artist", "Grave Titan"]'), { strategy: "Plain text.", winConditions: ["Drain with Blood Artist", "Grave Titan"] });
  assert.deepEqual(untangleText('["One", "Two"]', undefined), { strategy: "", winConditions: ["One", "Two"] });
  assert.deepEqual(untangleText('He said "go", and it went.', ["x"]), { strategy: 'He said "go", and it went.', winConditions: ["x"] });
});

// DEMO_MODE: a scripted stand-in for Claude. It streams through the same parser, tools and
// validation as the real thing (with real Scryfall data), so the full UI works without an
// API key. It only knows one deck: Meren of Clan Nel Toth aristocrats.
import { consumeStream, type ModelCaller } from "./anthropic";

export const DEMO_SEEDS = ["Meren of Clan Nel Toth", "Sakura-Tribe Elder", "Viscera Seer", "Eternal Witness", "Grim Haruspex"];

type C = [name: string, role: string, why: string];
const CARDS: C[] = [
  ["Sakura-Tribe Elder", "ramp", "Ramp now, sacrifice fodder later"],
  ["Sol Ring", "ramp", "Fastest mana rock in the format"],
  ["Arcane Signet", "ramp", "Two-color fixing on turn two"],
  ["Golgari Signet", "ramp", "More early fixing"],
  ["Cultivate", "ramp", "Ramp plus a land for the next turn"],
  ["Kodama's Reach", "ramp", "Cultivate number two"],
  ["Rampant Growth", "ramp", "Cheap land ramp"],
  ["Nature's Lore", "ramp", "Instant-speed Forest fetch"],
  ["Three Visits", "ramp", "Fetches Overgrown Tomb untapped"],
  ["Wood Elves", "ramp", "Ramp body Meren can recur"],
  ["Burnished Hart", "ramp", "Ramp that also dies on command"],
  ["Grim Haruspex", "draw", "Draws whenever a non-token creature dies"],
  ["Midnight Reaper", "draw", "Card per nontoken creature death"],
  ["Morbid Opportunist", "draw", "Extra card each turn things die"],
  ["Phyrexian Arena", "draw", "Steady card flow"],
  ["Harmonize", "draw", "Three cards for four mana"],
  ["Moldervine Reclamation", "draw", "Life and cards per death"],
  ["Dark Prophecy", "draw", "Death engine card draw"],
  ["Village Rites", "draw", "Sac outlet that refills hand"],
  ["Deadly Dispute", "draw", "Sacrifice into cards and a Treasure"],
  ["Tireless Tracker", "draw", "Lands become Clues"],
  ["Assassin's Trophy", "removal", "Answers any permanent"],
  ["Putrefy", "removal", "Instant creature/artifact removal"],
  ["Beast Within", "removal", "Catch-all instant answer"],
  ["Infernal Grasp", "removal", "Cheap, clean creature kill"],
  ["Go for the Throat", "removal", "Two-mana instant removal"],
  ["Krosan Grip", "removal", "Uncounterable artifact/enchantment answer"],
  ["Ravenous Chupacabra", "removal", "Removal Meren returns every turn"],
  ["Fleshbag Marauder", "removal", "Edict on a recursive body"],
  ["Plaguecrafter", "removal", "Repeatable edict with Meren"],
  ["Acidic Slime", "removal", "Recurring artifact/enchantment/land hate"],
  ["Bone Shards", "removal", "One-mana removal, discard fuel"],
  ["Damnation", "wipe", "Reset the board, rebuild with Meren"],
  ["Pestilence", "wipe", "Controllable sweeper and wincon"],
  ["Living Death", "wipe", "Swap boards with your full graveyard"],
  ["Heroic Intervention", "protection", "Saves the board from wipes"],
  ["Lightning Greaves", "protection", "Haste and shroud for Meren"],
  ["Swiftfoot Boots", "protection", "Second way to protect Meren"],
  ["Eternal Witness", "recursion", "Rebuy the best spell, repeatedly"],
  ["Animate Dead", "recursion", "Cheap reanimation"],
  ["Victimize", "recursion", "Two creatures back for three"],
  ["Phyrexian Reclamation", "recursion", "Mana sink to rebuy creatures"],
  ["Ramunap Excavator", "recursion", "Replay sacrificed and fetched lands"],
  ["Viscera Seer", "synergy", "Free sac outlet with scry"],
  ["Carrion Feeder", "synergy", "Sac outlet that grows"],
  ["Yawgmoth, Thran Physician", "synergy", "Sac outlet, draw and board control"],
  ["Ashnod's Altar", "synergy", "Turns deaths into mana"],
  ["Spore Frog", "synergy", "Recurring Fog"],
  ["Caustic Caterpillar", "synergy", "Recurring artifact/enchantment removal"],
  ["Reassembling Skeleton", "synergy", "Endless sacrifice fodder"],
  ["Satyr Wayfinder", "synergy", "Fills the graveyard, finds a land"],
  ["Stitcher's Supplier", "synergy", "Self-mill for Meren targets"],
  ["Golgari Grave-Troll", "synergy", "Dredge plus a huge body"],
  ["Liliana, Death's Majesty", "synergy", "Zombies and reanimation"],
  ["Fiend Artisan", "synergy", "Creature tutor that loves a full graveyard"],
  ["Mazirek, Kraul Death Priest", "synergy", "Counters every time anything is sacrificed"],
  ["Jarad's Orders", "utility", "Tutor a piece to hand and one to the graveyard"],
  ["Pitiless Plunderer", "ramp", "Every creature death makes a Treasure"],
  ["Grave Titan", "wincon", "Huge threat that leaves Zombies"],
  ["Massacre Wurm", "wincon", "One-sided wipe and drain"],
  ["Sheoldred, Whispering One", "wincon", "Edicts plus free reanimation"],
  ["Blood Artist", "wincon", "Every death drains"],
  ["Zulaport Cutthroat", "wincon", "Blood Artist number two"],
  ["Command Tower", "land", "Perfect fixing"],
  ["Overgrown Tomb", "land", "Untapped dual"],
  ["Woodland Cemetery", "land", "Untapped dual"],
  ["Llanowar Wastes", "land", "Untapped dual"],
  ["Twilight Mire", "land", "Filter land fixing"],
  ["Golgari Rot Farm", "land", "Karoo land; replay with Excavator"],
  ["Jungle Hollow", "land", "Tapped dual with life"],
  ["Temple of Malady", "land", "Tapped dual with scry"],
  ["Golgari Guildgate", "land", "Budget fixing"],
  ["Myriad Landscape", "land", "Ramp land"],
  ["Evolving Wilds", "land", "Fetch, replay with Excavator"],
  ["Terramorphic Expanse", "land", "Fetch, replay with Excavator"],
  ["Bojuka Bog", "land", "Graveyard hate on a land"],
  ["High Market", "land", "Sac outlet on a land"],
  ["Tainted Wood", "land", "Untapped dual next to a Swamp"],
  ["Takenuma, Abandoned Mire", "land", "Channel: rebuy a creature"],
];

export const DEMO_SUBMISSION = {
  deck_name: "Meren's Endless Harvest",
  commander: "Meren of Clan Nel Toth",
  strategy:
    "Sacrifice creatures for value, and let Meren bring the best one back every end step. Grim Haruspex, Midnight Reaper and friends turn every death into cards, while Viscera Seer and Ashnod's Altar make sure something always dies on our terms. Board wipes are fine — we rebuild faster than anyone.",
  win_conditions: [
    "Blood Artist / Zulaport Cutthroat drains with a sac outlet",
    "Grave Titan and Massacre Wurm recurred every turn",
    "Pestilence to sweep and burn the table",
    "Living Death into a graveyard full of threats",
  ],
  bracket_notes: "No Game Changers needed; no mass land denial, no extra turns and no early two-card infinite combos — the deck wins through incremental value.",
  cards: CARDS.map(([name, role, why]) => ({ name, role, why })),
  basics: { Forest: 10, Swamp: 10 },
};

function* chunks(s: string, n: number) {
  for (let i = 0; i < s.length; i += n) yield s.slice(i, i + n);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build a fake Messages-API event stream for a turn. */
async function* turnEvents(text: string, tools: { name: string; input: unknown }[], speed: number) {
  yield { event: "message_start", data: JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 0 } } }) };
  let idx = 0;
  yield { event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: idx, content_block: { type: "text", text: "" } }) };
  for (const c of chunks(text, 6)) {
    await sleep(18 * speed);
    yield { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: idx, delta: { type: "text_delta", text: c } }) };
  }
  yield { event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: idx }) };
  for (const t of tools) {
    idx++;
    const id = `toolu_demo_${Math.random().toString(36).slice(2, 10)}`;
    yield { event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: idx, content_block: { type: "tool_use", id, name: t.name, input: {} } }) };
    const json = JSON.stringify(t.input);
    const size = t.name === "submit_deck" ? 48 : 64;
    for (const c of chunks(json, size)) {
      await sleep((t.name === "submit_deck" ? 35 : 5) * speed);
      yield { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: c } }) };
    }
    yield { event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: idx }) };
  }
  yield { event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: tools.length ? "tool_use" : "end_turn" } }) };
  yield { event: "message_stop", data: JSON.stringify({ type: "message_stop" }) };
}

export function demoCaller(speed = 1): ModelCaller {
  let turn = 0;
  return async (_params, handlers) => {
    turn++;
    if (turn === 1) {
      return consumeStream(turnEvents("Let me read the seeds first: a sacrifice-and-recursion core in black-green, which Meren rewards every single turn.", [{ name: "get_cards", input: { names: DEMO_SEEDS } }], speed), handlers);
    }
    if (turn === 2) {
      return consumeStream(
        turnEvents(
          "Meren wants sacrifice outlets, death payoffs and cheap recursive creatures. Searching for the best ones in Golgari.",
          [
            { name: "search_cards", input: { query: "id<=bg f:commander otag:sacrifice-outlet t:creature", order: "edhrec", limit: 15 } },
            { name: "search_cards", input: { query: 'id<=bg f:commander o:"whenever another creature you control dies"', order: "edhrec", limit: 15 } },
            { name: "search_cards", input: { query: "id<=bg f:commander otag:ramp mv<=3 -t:land", order: "edhrec", limit: 15 } },
          ],
          speed,
        ),
        handlers,
      );
    }
    return consumeStream(turnEvents("I have what I need. Here's the full list — 63 spells, 16 nonbasic lands and 20 basics.", [{ name: "submit_deck", input: DEMO_SUBMISSION }], speed), handlers);
  };
}

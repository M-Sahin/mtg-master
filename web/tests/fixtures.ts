// Synthetic Scryfall data for tests. Shaped like Scryfall card objects; NOT a source of truth
// (colors/types are simplified where the tests don't care).
import { DEMO_SUBMISSION } from "../lib/server/demo";

const G = new Set(["Sakura-Tribe Elder", "Cultivate", "Kodama's Reach", "Rampant Growth", "Nature's Lore", "Three Visits", "Wood Elves", "Harmonize", "Tireless Tracker", "Beast Within", "Krosan Grip", "Acidic Slime", "Heroic Intervention", "Eternal Witness", "Ramunap Excavator", "Spore Frog", "Caustic Caterpillar", "Satyr Wayfinder", "Golgari Grave-Troll", "Forest"]);
const BG = new Set(["Meren of Clan Nel Toth", "Golgari Signet", "Moldervine Reclamation", "Assassin's Trophy", "Putrefy", "Fiend Artisan", "Mazirek, Kraul Death Priest", "Jarad's Orders", "Overgrown Tomb", "Woodland Cemetery", "Llanowar Wastes", "Twilight Mire", "Golgari Rot Farm", "Jungle Hollow", "Temple of Malady", "Golgari Guildgate"]);
const C = new Set(["Sol Ring", "Arcane Signet", "Burnished Hart", "Lightning Greaves", "Swiftfoot Boots", "Ashnod's Altar", "Command Tower", "Myriad Landscape", "Evolving Wilds", "Terramorphic Expanse", "High Market"]);
const LANDS = new Set(DEMO_SUBMISSION.cards.filter((c) => c.role === "land").map((c) => c.name).concat(["Forest", "Swamp", "Mountain", "Island", "Plains"]));

export function fakeCard(name: string, extra: Record<string, unknown> = {}) {
  const id = G.has(name) ? ["G"] : BG.has(name) ? ["B", "G"] : C.has(name) || LANDS.has(name) ? [] : ["B"];
  const basic = ["Forest", "Swamp", "Mountain", "Island", "Plains"].includes(name);
  const ci = basic ? [] : name === "Forest" ? [] : id;
  const legendary = name === "Meren of Clan Nel Toth" || name.includes(",");
  const type = basic ? `Basic Land — ${name}` : LANDS.has(name) ? "Land" : legendary ? "Legendary Creature — Human Shaman" : "Creature — Elf";
  return {
    object: "card",
    name,
    mana_cost: LANDS.has(name) ? "" : "{1}{B}",
    cmc: LANDS.has(name) ? 0 : 2,
    type_line: type,
    oracle_text: `${name} does a thing.`,
    color_identity: ci,
    legalities: { commander: "legal" },
    game_changer: false,
    prices: { eur: "0.50", usd: "0.60" },
    artist: "Test Artist",
    image_uris: { normal: `https://img.example/${encodeURIComponent(name)}.jpg`, art_crop: `https://img.example/${encodeURIComponent(name)}-art.jpg` },
    scryfall_uri: `https://scryfall.com/card/x/1/${encodeURIComponent(name)}?utm_source=api`,
    ...extra,
  };
}

export const SPECIAL: Record<string, any> = {
  "Lightning Bolt": fakeCard("Lightning Bolt", { color_identity: ["R"], type_line: "Instant" }),
  "Mana Crypt": fakeCard("Mana Crypt", { color_identity: [], type_line: "Artifact", legalities: { commander: "banned" } }),
  "Demonic Tutor": fakeCard("Demonic Tutor", { type_line: "Sorcery", game_changer: true }),
  "Vampiric Tutor": fakeCard("Vampiric Tutor", { type_line: "Instant", game_changer: true }),
  "Necropotence": fakeCard("Necropotence", { type_line: "Enchantment", game_changer: true }),
  "Bolas's Citadel": fakeCard("Bolas's Citadel", { type_line: "Legendary Artifact", game_changer: true }),
  "Armageddon": fakeCard("Armageddon", { color_identity: ["W"], type_line: "Sorcery", oracle_text: "Destroy all lands." }),
  "Llanowar Elves": fakeCard("Llanowar Elves", { color_identity: ["G"] }),
  "Relentless Rats": fakeCard("Relentless Rats", { oracle_text: "A deck can have any number of cards named Relentless Rats." }),
};

export const UNKNOWN = new Set(["Lightnig Bolt", "Not A Real Card"]);

const DFC = {
  ...fakeCard("Ojer Axonil, Deepest Might // Temple of Power", { color_identity: ["R"], type_line: "Legendary Creature — God // Land" }),
  card_faces: [
    { name: "Ojer Axonil, Deepest Might", mana_cost: "{2}{R}{R}", type_line: "Legendary Creature — God", oracle_text: "Trample" },
    { name: "Temple of Power", mana_cost: "", type_line: "Land", oracle_text: "{T}: Add {R}." },
  ],
};

export function lookupFake(name: string) {
  if (UNKNOWN.has(name)) return null;
  const n = name.toLowerCase();
  if (n === DFC.name.toLowerCase() || DFC.card_faces.some((f) => f.name.toLowerCase() === n)) return DFC;
  return SPECIAL[name] ?? fakeCard(name);
}

/** Install a fake global fetch that answers Scryfall endpoints from the fixtures. */
export function installFakeScryfall() {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/cards/collection")) {
      const ids = JSON.parse(init.body).identifiers as { name: string }[];
      const data: any[] = [];
      const not_found: any[] = [];
      for (const i of ids) {
        const c = i.name.includes(" // ") ? null : lookupFake(i.name); // real Scryfall: full DFC names don't match here
        c ? data.push(c) : not_found.push(i);
      }
      return json({ object: "list", data, not_found });
    }
    if (url.includes("/cards/search")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      if (q.includes("nothingmatches")) return json({ object: "error", details: "Your query didn't match any cards." }, 404);
      return json({ object: "list", total_cards: 2, data: [fakeCard("Blood Artist"), fakeCard("Zulaport Cutthroat")] });
    }
    if (url.includes("/cards/named")) {
      const p = new URL(url).searchParams;
      const c = lookupFake(p.get("exact") ?? p.get("fuzzy") ?? "");
      return c ? json(c) : json({ object: "error", details: "not found" }, 404);
    }
    return json({ object: "error", details: `no fixture for ${url}` }, 404);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

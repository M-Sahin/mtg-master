// One-tap starts for a first visit: five seeds and a commander. The first is the demo deck's seeds
// (the only one a site without a Claude key can build).
export interface ExampleSeeds {
  label: string;
  commander: string;
  seeds: string[];
}

export const EXAMPLES: ExampleSeeds[] = [
  { label: "Meren, graveyard value", commander: "Meren of Clan Nel Toth", seeds: ["Meren of Clan Nel Toth", "Sakura-Tribe Elder", "Viscera Seer", "Eternal Witness", "Grim Haruspex"] },
  { label: "Krenko, goblin swarm", commander: "Krenko, Mob Boss", seeds: ["Krenko, Mob Boss", "Goblin Chieftain", "Skirk Prospector", "Impact Tremors", "Goblin Bombardment"] },
  { label: "Atraxa, +1/+1 counters", commander: "Atraxa, Praetors' Voice", seeds: ["Atraxa, Praetors' Voice", "Hardened Scales", "Inexorable Tide", "Evolution Sage", "Flux Channeler"] },
];

export const sameSeeds = (a: string[], b: string[]) => a.map((s) => s.toLowerCase()).sort().join("|") === b.map((s) => s.toLowerCase()).sort().join("|");

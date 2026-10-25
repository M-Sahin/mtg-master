#!/usr/bin/env node
// Calibrates the Oracle-text role detector (lib/shared/analysis.ts) against Scryfall Tagger:
// for each function, the most-played Commander cards WITH the tag (recall) and the most-played
// nonland cards WITHOUT it (false positives). Needs network access to Scryfall (used in CI).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(import.meta.url)("esbuild");
const entry = join(here, "..", ".test-build", "calibrate-entry.ts");
const out = join(here, "..", ".test-build", "calibrate.mjs");
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `export * from "../lib/shared/analysis"; export { search } from "../lib/server/scryfall";`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const { detectFunctions, search, isLand } = await import(pathToFileURL(out).href);

const TAGS = [
  ["ramp", "otag:ramp -t:land"],
  ["draw", "otag:card-advantage -t:land"],
  ["removal", "otag:removal -otag:board-wipe -t:land"],
  ["wipe", "otag:board-wipe"],
  ["recursion", "(otag:reanimate or otag:regrowth) -t:land"],
  ["protection", "(otag:gives-hexproof or otag:gives-indestructible or otag:gives-shroud) -t:land"],
];

let bad = false;
for (const [fn, q] of TAGS) {
  const pos = await search(`f:commander ${q}`, "edhrec", 40);
  const neg = await search(`f:commander -t:land -(${q.replace(/ -t:land$/, "")})`, "edhrec", 40);
  const hit = pos.cards.filter((c) => detectFunctions(c).has(fn));
  const miss = pos.cards.filter((c) => !detectFunctions(c).has(fn) && !isLand(c));
  const fp = neg.cards.filter((c) => detectFunctions(c).has(fn));
  const recall = pos.cards.length ? hit.length / pos.cards.length : 0;
  console.log(`${fn.padEnd(10)} recall ${Math.round(recall * 100)}% (${hit.length}/${pos.cards.length})  false positives ${fp.length}/${neg.cards.length}`);
  if (miss.length) console.log(`  missed: ${miss.map((c) => c.name).join("; ")}`);
  if (fp.length) console.log(`  false positives: ${fp.map((c) => c.name).join("; ")}`);
  if (pos.error) console.log(`  search error: ${pos.error}`);
  if (pos.cards.length && recall < 0.6) bad = true;
}
// The calibration is informative; it fails only if a detector is badly broken.
if (bad) {
  console.error("A detector found fewer than 60% of its tagged cards.");
  process.exit(1);
}

#!/usr/bin/env node
// Live check of the Scryfall client against the real API (used in CI):
// double-faced, split and accented card names must all resolve.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(import.meta.url)("esbuild");
const out = join(here, "..", ".test-build", "scryfall-live.mjs");
await esbuild.build({ entryPoints: [join(here, "..", "lib", "server", "scryfall.ts")], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const { getCollection } = await import(pathToFileURL(out).href);

const names = [
  "Ojer Axonil, Deepest Might // Temple of Power", // transforming DFC
  "Alrund, God of the Cosmos // Hakka, Whispering Raven", // modal DFC
  "Temple of Power", // back face only
  "Fire // Ice", // split card
  "Lim-Dûl's Vault", // diacritics
  "Sol Ring",
];
const { found, notFound } = await getCollection(names);
for (const n of names) console.log(`${found.get(n.toLowerCase())?.name ?? "MISSING"}  <=  ${n}`);
if (notFound.length) {
  console.error("LIVE SCRYFALL CHECK FAILED, not found:", notFound);
  process.exit(1);
}
console.log("Live Scryfall check OK");

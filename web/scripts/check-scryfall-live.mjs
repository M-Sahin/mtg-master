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
const { writeFileSync, mkdirSync } = await import("node:fs");
const entry = join(here, "..", ".test-build", "scryfall-live-entry.ts");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `export * from "../lib/server/scryfall"; export { pairingProblem } from "../lib/server/validate";`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const { getCollection, previewArt, pairingProblem } = await import(pathToFileURL(out).href);

const names = [
  "Ojer Axonil, Deepest Might // Temple of Power", // transforming DFC
  "Alrund, God of the Cosmos // Hakka, Whispering Raven", // modal DFC
  "Temple of Power", // back face only
  "Fire // Ice", // split card
  "Lim-Dûl's Vault", // diacritics
  "Sol Ring",
];
const { found, notFound } = await getCollection(names);
// pairing abilities on real Oracle text: named partners ("Partner—Father & son"), plain Partner, Partner with
const pairs = [
  ["Kratos, Stoic Father", "Atreus, Impulsive Son", true],
  ["Thrasios, Triton Hero", "Tymna the Weaver", true],
  ["Pir, Imaginative Rascal", "Toothy, Imaginary Friend", true],
  ["Kratos, Stoic Father", "Tymna the Weaver", false],
];
const pairCards = await getCollection(pairs.flatMap(([a, b]) => [a, b]));
for (const [a, b, ok] of pairs) {
  const ca = pairCards.found.get(a.toLowerCase());
  const cb = pairCards.found.get(b.toLowerCase());
  const why = ca && cb ? pairingProblem(ca, cb) : "card not found";
  console.log(`pair ${a} + ${b}: ${why ?? "ok"}`);
  if ((why === null) !== ok) {
    console.error(`PAIRING CHECK FAILED for ${a} + ${b}${ca ? `\n  ${a}: ${JSON.stringify(ca.oracleText)}` : ""}`);
    process.exitCode = 1;
  }
}
for (const n of names) console.log(`${found.get(n.toLowerCase())?.name ?? "MISSING"}  <=  ${n}`);
if (notFound.length) {
  console.error("LIVE SCRYFALL CHECK FAILED, not found:", notFound);
  process.exit(1);
}
// what image formats does Scryfall serve today? (the OG preview needs JPEG or PNG)
const art = found.get("sol ring")?.artCrop;
if (art) {
  for (const accept of ["*/*", "image/jpeg,image/png;q=0.9"]) {
    const r = await fetch(art, { headers: { Accept: accept } });
    console.log(`art_crop with Accept ${accept}: HTTP ${r.status} ${r.headers.get("content-type")} (${art.split("?")[0].split(".").pop()})`);
  }
}
const preview = await previewArt("Meren of Clan Nel Toth");
console.log(`previewArt: ${preview ? `${preview.full ? "full card PNG" : "art crop"}, ${preview.src.slice(5, 20)}…, ${Math.round(preview.src.length / 1024)} KB, artist ${preview.artist}` : "NONE"}`);
if (!preview) {
  console.error("No usable preview image for link previews");
  process.exit(1);
}
console.log("Live Scryfall check OK");

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
const { getCollection, previewArt } = await import(pathToFileURL(out).href);

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

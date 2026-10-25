#!/usr/bin/env node
// Prints the opening-hand check (lib/shared/openers.ts) for real decklists, with real Scryfall
// data, and what the server's basic-land rebalance would change. Needs Scryfall (used in CI).
//   node scripts/check-openers.mjs [decklist.txt …]   (default: evals/sample-decks/*.txt)
import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let esbuild;
try {
  esbuild = createRequire(import.meta.url)("esbuild");
} catch {
  esbuild = createRequire(import.meta.url)(process.env.ESBUILD_PATH || "/opt/npm-tools/node_modules/esbuild");
}
const entry = join(root, ".test-build", "openers-entry.ts");
const out = join(root, ".test-build", "openers.mjs");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(
  entry,
  `export * from "../lib/shared/openers"; export { parseDecklist } from "../lib/shared/decklist"; export { getCollection } from "../lib/server/scryfall"; export { rebalanceBasics } from "../lib/server/validate";`,
);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const { simulateOpeners, openerReport, parseDecklist, getCollection, rebalanceBasics } = await import(pathToFileURL(out).href);

const dir = join(root, "evals", "sample-decks");
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => join(dir, f));

for (const file of files) {
  const parsed = parseDecklist(readFileSync(file, "utf8"));
  const cmdNames = parsed.commanders.length ? parsed.commanders : parsed.commanderGuess;
  const { found, notFound } = await getCollection([...cmdNames, ...parsed.cards.map((c) => c.name)]);
  const info = (n) => found.get(n.toLowerCase());
  const commanders = cmdNames.map((n) => ({ name: info(n)?.name ?? n, role: "commander", why: "", qty: 1, info: info(n) }));
  const cards = parsed.cards.filter((c) => !cmdNames.includes(c.name)).map((c) => ({ name: info(c.name)?.name ?? c.name, role: "synergy", why: "", qty: c.qty, info: info(c.name) }));
  const colorIdentity = [...new Set(commanders.flatMap((c) => c.info?.colorIdentity ?? []))];
  const deck = { name: basename(file), strategy: "", winConditions: [], bracketNotes: "", colorIdentity, commander: commanders[0], partner: commanders[1], cards };
  console.log(`\n## ${basename(file)}: ${commanders.map((c) => c.name).join(" + ")}${notFound.length ? ` (not found: ${notFound.join(", ")})` : ""}`);
  console.log(openerReport(simulateOpeners(deck)));
  const after = structuredClone(deck);
  const change = rebalanceBasics(after);
  if (change) {
    console.log(`\nWith the server's basic-land rebalance: ${change}`);
    console.log(openerReport(simulateOpeners(after)));
  }
}

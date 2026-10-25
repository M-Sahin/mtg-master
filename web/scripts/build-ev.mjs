#!/usr/bin/env node
// Builds the Box EV data: pack layouts and slot odds from taw/magic-sealed-data (the source of
// MTGJSON's booster data) and Cardmarket trend prices from Scryfall. Runs daily in CI
// (.github/workflows/ev-data.yml), which publishes the output to the ev-data branch.
//   node scripts/build-ev.mjs [--out ev-out] [--sealed sealed_extended_data.json] [--since 2020-01-01] [--only dsk-play,…]
// Output: <out>/index.json (one row per product), <out>/names.json (card → products, for the
// deck view), <out>/p/<id>.json (everything a product page needs).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : acc), []),
);
const out = args.out ?? "ev-out";
const since = args.since ?? "2020-01-01";
const only = args.only ? new Set(args.only.split(",")) : null;

let esbuild;
try {
  esbuild = createRequire(import.meta.url)("esbuild");
} catch {
  esbuild = createRequire(import.meta.url)(process.env.ESBUILD_PATH || "/opt/npm-tools/node_modules/esbuild");
}
const entry = join(root, ".test-build", "ev-entry.ts");
const bundle = join(root, ".test-build", "ev.mjs");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `export * from "../lib/shared/ev"; export { nameKey } from "../lib/shared/types";`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "warning" });
const { summarize, namesPerBox, nameKey, topCards, gross, PACKS_PER_BOX } = await import(pathToFileURL(bundle).href);

const UA = { "User-Agent": "hundredfoldz-mtg-master/1.0 (+https://github.com/M-Sahin/mtg-master)", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function scryfall(path, body) {
  // Scryfall: at most 2 requests a second on /cards/collection; back off for 30 s after a 429
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + 520 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(`https://api.scryfall.com${path}`, body ? { method: "POST", headers: { ...UA, "Content-Type": "application/json" }, body: JSON.stringify(body) } : { headers: UA });
    if (res.status === 429) {
      await sleep(30_000);
      continue;
    }
    if (res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return res.json();
  }
  throw new Error(`Scryfall kept failing for ${path}`);
}

// ---- 1. sealed data and sets
const started = Date.now();
const sealed = args.sealed
  ? JSON.parse(readFileSync(args.sealed, "utf8"))
  : await (await fetch("https://raw.githubusercontent.com/taw/magic-sealed-data/master/sealed_extended_data.json")).json();
console.log(`sealed data: ${sealed.length} products`);
const sets = new Map((await scryfall("/sets")).data.map((s) => [s.code, s]));
const soon = new Date(Date.now() + 45 * 86400_000).toISOString().slice(0, 10);

const KINDS = ["play", "collector", "set", "draft"];
const chosen = sealed.filter((b) => {
  const m = b.code.match(/^([a-z0-9]+)-(play|collector|set|draft)$/);
  if (!m || (only && !only.has(b.code))) return false;
  const s = sets.get(m[1]);
  const released = s?.released_at ?? "";
  return released >= since && released <= soon;
});
console.log(`products since ${since}: ${chosen.length}`);

// ---- 2. prices for every card those products can contain
const key = (set, number) => `${set}/${number}`;
const want = new Map();
for (const b of chosen) for (const sh of Object.values(b.sheets)) for (const c of sh.cards) want.set(key(c.set, c.number), { set: c.set, number: c.number });
console.log(`cards to price: ${want.size}`);
const found = new Map();
const todo = [...want.values()];
const missing = [];
for (let i = 0; i < todo.length; i += 75) {
  const chunk = todo.slice(i, i + 75);
  const res = await scryfall("/cards/collection", { identifiers: chunk.map((c) => ({ set: c.set, collector_number: c.number })) });
  for (const card of res.data ?? []) found.set(key(card.set, card.collector_number), card);
  for (const nf of res.not_found ?? []) missing.push(nf);
  if ((i / 75) % 40 === 0) console.log(`  priced ${Math.min(i + 75, todo.length)}/${todo.length} (${Math.round((Date.now() - started) / 1000)} s)`);
}
// second try for numbers Scryfall writes differently: "3a" → "3", "123★" → "123"
const retry = missing.map((m) => ({ orig: m, number: String(m.collector_number).replace(/[a-z★†]+$/i, "") })).filter((m) => m.number && m.number !== m.orig.collector_number);
for (let i = 0; i < retry.length; i += 75) {
  const chunk = retry.slice(i, i + 75);
  const res = await scryfall("/cards/collection", { identifiers: chunk.map((c) => ({ set: c.orig.set, collector_number: c.number })) });
  const byNum = new Map((res.data ?? []).map((card) => [key(card.set, card.collector_number), card]));
  for (const c of chunk) {
    const card = byNum.get(key(c.orig.set, c.number));
    if (card) found.set(key(c.orig.set, c.orig.collector_number), card);
  }
}
const unresolved = todo.filter((c) => !found.has(key(c.set, c.number)));
console.log(`priced: ${found.size}/${want.size}; not on Scryfall: ${unresolved.length}${unresolved.length ? ` (e.g. ${unresolved.slice(0, 12).map((c) => key(c.set, c.number)).join(", ")})` : ""}`);

// ---- 3. packs per box from MTGJSON's sealed products (booster boxes differ: 36, 30, 24, 12, 4…)
const boxSize = new Map(); // "dsk-play" → packs
let probe = Number(args.probe ?? 0);
for (const setCode of [...new Set(chosen.map((b) => b.code.split("-")[0]))]) {
  let json = null;
  try {
    const res = await fetch(`https://mtgjson.com/api/v5/${setCode.toUpperCase()}.json.gz`, { headers: { "User-Agent": UA["User-Agent"] } });
    if (res.ok) json = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  } catch (e) {
    console.log(`  MTGJSON ${setCode}: ${e.message}`);
  }
  const products = json?.data?.sealedProduct ?? [];
  const byUuid = new Map(products.map((p) => [p.uuid, p]));
  for (const p of products) {
    if (p.category !== "booster_box") continue;
    const kind = String(p.subtype ?? "").toLowerCase();
    if (!KINDS.includes(kind)) continue;
    // the box holds its booster packs (e.g. 30 × "… Play Booster Pack"), sometimes with a box
    // topper or promo pack next to them: take the biggest count of real booster packs
    let packs = 0;
    const extra = /topper|promo|sample|bonus|prerelease|gift/i;
    for (const x of [...(p.contents?.sealed ?? []), ...(p.contents?.pack ?? [])]) {
      const inner = byUuid.get(x.uuid);
      const name = String(x.name ?? inner?.name ?? "");
      if (extra.test(name) || (inner && inner.category && inner.category !== "booster_pack")) continue;
      packs = Math.max(packs, Number(x.count ?? 1));
    }
    if (!packs && Number(p.productSize) > 0) packs = Number(p.productSize);
    if (probe > 0) {
      console.log(`  probe ${setCode} ${kind}: ${JSON.stringify({ name: p.name, subtype: p.subtype, productSize: p.productSize, contents: p.contents }).slice(0, 700)}`);
    }
    const id = `${setCode}-${kind}`;
    // several box products (a Japanese box, a case): keep the first plain one
    if (packs > 0 && packs <= 60 && !boxSize.has(id) && !/japanese|\bjp\b|case/i.test(p.name ?? "")) boxSize.set(id, packs);
  }
  if (probe > 0) probe--;
}
console.log(`box sizes from MTGJSON: ${boxSize.size} (${[...boxSize].slice(0, 30).map(([k, v]) => `${k} ${v}`).join(", ")})`);

// ---- 4. products
const num = (x) => (x == null || x === "" ? null : Number(x));
const RARITY = { common: "c", uncommon: "u", rare: "r", mythic: "m", special: "s", bonus: "b" };
const image = (card) => card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
mkdirSync(join(out, "p"), { recursive: true });
const rows = [];
const names = { products: [], names: {} };
const pricedAt = new Date().toISOString();
for (const b of chosen) {
  const [setCode, kind] = b.code.split("-");
  const s = sets.get(setCode);
  const cards = [];
  const idx = new Map();
  const cardIndex = (c) => {
    const k = `${key(c.set, c.number)}/${c.foil ? 1 : 0}`;
    if (idx.has(k)) return idx.get(k);
    const sc = found.get(key(c.set, c.number));
    const p = sc ? num(c.foil ? (sc.prices?.eur_foil ?? (sc.finishes?.length === 1 && sc.finishes[0] !== "nonfoil" ? sc.prices?.eur : null)) : sc.prices?.eur) : null;
    const entry = { n: sc?.name ?? `${c.set.toUpperCase()} #${c.number}`, s: c.set, c: c.number, f: c.foil ? 1 : 0, p };
    if (sc?.rarity && RARITY[sc.rarity]) entry.r = RARITY[sc.rarity];
    if (p != null && p >= 3 && image(sc)) entry.img = image(sc);
    idx.set(k, cards.length);
    cards.push(entry);
    return cards.length - 1;
  };
  const sheets = {};
  for (const [name, sh] of Object.entries(b.sheets)) {
    const c = [];
    const w = [];
    for (const card of sh.cards) {
      c.push(cardIndex(card));
      w.push(card.weight);
    }
    sheets[name] = { c, w, t: sh.total_weight ?? w.reduce((a, x) => a + x, 0), ...(sh.allow_duplicates ? { dup: true } : {}) };
  }
  const prod = {
    id: b.code,
    name: b.name,
    set: setCode,
    setName: b.set_name,
    released: s?.released_at ?? "",
    kind,
    packsPerBox: boxSize.get(b.code) ?? PACKS_PER_BOX[kind],
    pricedAt,
    ...(s?.icon_svg_uri ? { icon: s.icon_svg_uri } : {}),
    cards,
    sheets,
    packs: b.boosters.map((x) => ({ w: x.weight, s: x.sheets })),
  };
  writeFileSync(join(out, "p", `${b.code}.json`), JSON.stringify(prod));
  const row = summarize(prod);
  rows.push(row);
  const pi = names.products.length;
  names.products.push({ id: row.id, name: row.name, kind: row.kind, packsPerBox: row.packsPerBox, grossBox: row.grossBox, released: row.released });
  for (const [k, perBox] of namesPerBox(prod, nameKey)) if (perBox >= 0.002) (names.names[k] ??= []).push([pi, Math.round(perBox * 1e4) / 1e4]);
  const top = topCards(prod, gross, 3).map((t) => `${t.card.n}${t.card.f ? " (foil)" : ""} ${Math.round(t.share * 100)}%`);
  console.log(`${b.code.padEnd(16)} gross €${row.grossBox.toFixed(0).padStart(5)}  net €${row.netBox.toFixed(0).padStart(5)}  unpriced ${Math.round(row.unpriced * 100)}%  top: ${top.join("; ")}`);
}
// ---- 5. Card Kingdom prices (Scryfall has Cardmarket and TCGplayer prices, not Card Kingdom's):
// the cheapest in-stock non-foil copy of each card, for the card buy links
try {
  let ck = null;
  for (const url of ["https://api.cardkingdom.com/api/v2/pricelist", "https://api.cardkingdom.com/api/pricelist"]) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) {
      ck = await res.json();
      console.log(`Card Kingdom: ${url}, ${ck?.data?.length ?? 0} rows; first: ${JSON.stringify(ck?.data?.[0] ?? null).slice(0, 400)}`);
      break;
    }
    console.log(`Card Kingdom: ${url} → ${res.status}`);
  }
  const best = {};
  for (const r of ck?.data ?? []) {
    if (!r?.name || String(r.is_foil) === "true") continue;
    const price = Number(r.price_retail);
    if (!(price > 0)) continue;
    const k = nameKey(String(r.name));
    const stock = Number(r.qty_retail ?? 0) > 0;
    const cur = best[k];
    // in stock beats out of stock, then cheaper
    if (!cur || (stock && !cur[2]) || (stock === !!cur[2] && price < cur[0])) best[k] = [Math.round(price * 100) / 100, String(r.url ?? ""), stock ? 1 : 0];
  }
  writeFileSync(join(out, "ck-prices.json"), JSON.stringify(best));
  console.log(`Card Kingdom prices: ${Object.keys(best).length} cards`);
} catch (e) {
  console.log(`Card Kingdom prices skipped: ${e.message}`);
}

rows.sort((a, b) => b.released.localeCompare(a.released) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
writeFileSync(join(out, "index.json"), JSON.stringify({ generatedAt: pricedAt, source: "taw/magic-sealed-data + Scryfall (Cardmarket trend, EUR)", products: rows }));
writeFileSync(join(out, "names.json"), JSON.stringify(names));
console.log(`wrote ${rows.length} products in ${Math.round((Date.now() - started) / 1000)} s`);
if (!rows.length) process.exit(1);

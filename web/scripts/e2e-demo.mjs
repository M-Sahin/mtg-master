#!/usr/bin/env node
// End-to-end check against a running server in demo mode (no API key needed) with REAL Scryfall:
//   BASE_URL=http://localhost:3000 node scripts/e2e-demo.mjs
// Verifies the streaming protocol and that the demo deck validates (100 cards, legal, in identity).
const base = process.env.BASE_URL ?? "http://localhost:3000";
const fail = (m) => {
  console.error("E2E FAIL:", m);
  process.exit(1);
};

const cfg = await (await fetch(`${base}/api/config`)).json();
console.log("config:", cfg);
if (cfg.mode !== "demo") fail("server is not in demo mode");

const ac = await (await fetch(`${base}/api/cards/autocomplete?q=viscera`)).json();
if (!ac.data?.includes("Viscera Seer")) fail(`autocomplete: ${JSON.stringify(ac)}`);
const named = await (await fetch(`${base}/api/cards/named?name=${encodeURIComponent("Meren of Clan Nel Toth")}`)).json();
if (!named.card?.canBeCommander || named.card.colorIdentity.join("") !== "BG") fail(`named: ${JSON.stringify(named)}`);
const rnd = await fetch(`${base}/api/cards/random?kind=card&id=bg`);
if (!rnd.ok) fail(`random: ${rnd.status}`);

const t0 = Date.now();
const res = await fetch(`${base}/api/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ seeds: cfg.demoSeeds, commander: null, budget: "any" }),
});
if (!res.ok) fail(`generate HTTP ${res.status}: ${await res.text()}`);
const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
const count = (t) => events.filter((e) => e.type === t).length;
console.log("events:", Object.fromEntries(["status", "text", "tool", "tool_result", "draft_card", "validation", "deck", "error", "done"].map((t) => [t, count(t)])), `${Date.now() - t0} ms`);
const err = events.find((e) => e.type === "error");
if (err) fail(err.message);
const deck = events.find((e) => e.type === "deck");
if (!deck) fail("no deck event");
for (const v of events.filter((e) => e.type === "validation")) console.log(`validation attempt ${v.attempt}:`, v.validation);
if (!deck.validation.ok) fail(`demo deck does not validate against real Scryfall:\n- ${deck.validation.errors.join("\n- ")}`);
if (deck.validation.total !== 100) fail(`total ${deck.validation.total}`);
const missingImg = deck.deck.cards.filter((c) => !c.info?.image).map((c) => c.name);
if (missingImg.length) fail(`cards without Scryfall data: ${missingImg.join(", ")}`);
console.log(`E2E OK: "${deck.deck.name}", ${deck.validation.total} cards, Game Changers: ${deck.validation.gameChangers.join(", ") || "none"}; warnings: ${deck.validation.warnings.join(" | ") || "none"}`);

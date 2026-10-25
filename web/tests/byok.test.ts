// Own API keys, model choice, friendly errors, collections.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelError, friendlyModelError } from "../lib/server/anthropic";
import { DEMO_SEEDS, DEMO_SUBMISSION } from "../lib/server/demo";
import { handleGenerate, handleKeyCheck, parseRequest } from "../lib/server/generate-handler";
import { runAgent } from "../lib/server/agent";
import { userPrompt } from "../lib/server/prompt";
import { toCardInfo } from "../lib/server/scryfall";
import { parseCollection } from "../lib/shared/collection";
import { costUsd, formatCost } from "../lib/shared/models";
import type { ModelCaller } from "../lib/server/anthropic";
import type { SubmittedDeck } from "../lib/server/validate";
import { installFakeScryfall, lookupFake } from "./fixtures";

const KEY = "sk-ant-api03-" + "x".repeat(40);
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ seeds: ["Sol Ring", "Viscera Seer", "Grim Haruspex", "Eternal Witness", "Meren of Clan Nel Toth"], commander: null, budget: "any", ...extra });

test("own key: any seeds, chosen model, no access code needed; bad keys rejected early", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const fake = installFakeScryfall();
  try {
    let seenModel = "";
    let seenKey = "";
    const original = globalThis.fetch;
    // the build talks to api.anthropic.com with the visitor's key: capture it, then fail fast
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).startsWith("https://api.anthropic.com/v1/messages")) {
        seenKey = init.headers["x-api-key"];
        seenModel = JSON.parse(init.body).model;
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      let after: Promise<unknown> | undefined;
      const res = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { "x-anthropic-key": KEY }, body: body({ model: "claude-opus-5-5" }) }), { waitUntil: (p) => (after = p) });
      assert.equal(res.status, 200, "no demo restriction, no access code");
      const text = await res.text();
      await after;
      assert.equal(seenKey, KEY);
      assert.equal(seenModel, "claude-opus-5-5");
      assert.match(text, /out of credit\. Add credit in the Claude Console/);
      assert.ok(!text.includes(KEY), "the key never appears in the stream");
    } finally {
      globalThis.fetch = original;
    }
    const bad = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { "x-anthropic-key": "hello" }, body: body() }));
    assert.equal(bad.status, 400);
    // without a key, only the demo deck
    const noKey = await handleGenerate(new Request("http://x/api/generate", { method: "POST", body: body() }));
    assert.equal(noKey.status, 400);
    assert.match((await noKey.json()).error, /Add your own Claude API key/);
    process.env.OWN_KEYS = "0";
    const off = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { "x-anthropic-key": KEY }, body: body() }));
    assert.equal(off.status, 403);
  } finally {
    delete process.env.OWN_KEYS;
    fake.restore();
  }
});

test("key check lists the key's models and explains failures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith("https://api.anthropic.com/v1/models")) {
      if (init.headers["x-api-key"] === KEY) return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }] }), { status: 200 });
      return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 });
    }
    return original(input, init);
  }) as typeof fetch;
  try {
    const ok = await handleKeyCheck(new Request("http://x/api/key/check", { method: "POST", body: JSON.stringify({ key: KEY }) }));
    assert.deepEqual((await ok.json()).models, [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }]);
    const wrong = await handleKeyCheck(new Request("http://x/api/key/check", { method: "POST", body: JSON.stringify({ key: "sk-ant-api03-" + "y".repeat(40) }) }));
    assert.equal(wrong.status, 400);
    assert.match((await wrong.json()).error, /didn't accept this API key/);
    const junk = await handleKeyCheck(new Request("http://x/api/key/check", { method: "POST", body: JSON.stringify({ key: "nope" }) }));
    assert.equal(junk.status, 400);
  } finally {
    globalThis.fetch = original;
  }
});

test("friendly errors for the usual API problems", () => {
  assert.match(friendlyModelError(new ModelError("Claude API 400: Your credit balance is too low", 400)), /out of credit/);
  assert.match(friendlyModelError(new ModelError("Claude API 400: You have reached your specified API usage limits", 400)), /spend limit/);
  assert.match(friendlyModelError(new ModelError("Claude API 401: invalid x-api-key", 401)), /didn't accept/);
  assert.match(friendlyModelError(new ModelError("Claude API 404: model: claude-x", 404)), /isn't available/);
  assert.match(friendlyModelError(new ModelError("Claude API 429: rate", 429)), /rate limit/);
  assert.match(friendlyModelError(new ModelError("Claude API 529: Overloaded", 529)), /overloaded/);
  assert.equal(friendlyModelError(new Error("something else")), "something else");
});

test("cost estimate per model", () => {
  const u = { calls: 6, input: 20_000, output: 30_000, cacheRead: 400_000, cacheWrite: 30_000 };
  const c = costUsd("claude-sonnet-5-5", u)!;
  assert.ok(Math.abs(c - (0.04 + 0.3 + 0.04 + 0.075)) < 1e-9);
  assert.equal(costUsd("claude-unknown", u), null);
  assert.equal(formatCost(0.4567), "about $0.46");
  assert.equal(formatCost(null), "cost unknown for this model");
});

test("collections parse from CSV exports and plain lists", () => {
  const moxfield = `"Count","Tradelist Count","Name","Edition","Condition"\n"1","0","Sol Ring","cmr","NM"\n"2","0","Fire // Ice","mh2","NM"\n"1","0","Sol Ring","c21","NM"`;
  assert.deepEqual(parseCollection(moxfield).names, ["Sol Ring", "Fire // Ice"]);
  const manabox = `Name,Set code,Set name,Collector number,Foil\nLightning Bolt,M10,Magic 2010,146,normal`;
  assert.deepEqual(parseCollection(manabox).names, ["Lightning Bolt"]);
  const semicolon = `Quantity;Name;Set\n1;Counterspell;7ED`;
  assert.deepEqual(parseCollection(semicolon).names, ["Counterspell"]);
  const list = `Commander\n1 Meren of Clan Nel Toth\n1x Sol Ring (CMR) 263 *F*\n4 Forest\nEternal Witness [M15]\n// comment\n`;
  assert.deepEqual(parseCollection(list).names, ["Meren of Clan Nel Toth", "Sol Ring", "Forest", "Eternal Witness"]);
});

test("parseRequest keeps a collection; the prompt lists it and the rule", () => {
  const r = parseRequest({ seeds: ["a", "b", "c", "d", "e"], commander: null, budget: "any", collection: { names: ["Sol Ring", "Sol Ring", " "], mode: "only" } });
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.collection, { names: ["Sol Ring"], mode: "only" });
  assert.equal(typeof parseRequest({ seeds: ["a", "b", "c", "d", "e"], collection: { names: Array.from({ length: 5001 }, (_, i) => `c${i}`) } }), "string");
  const seeds = DEMO_SEEDS.map((n) => toCardInfo(lookupFake(n)));
  const p = userPrompt({ ...r, seeds: DEMO_SEEDS }, seeds);
  assert.match(p, /COLLECTION: the user owns these 1 cards\. Build ONLY from cards in this collection/);
  assert.match(p, /<collection>\nSol Ring\n<\/collection>/);
});

test("only-owned mode: unowned cards are sent back to Claude; owned cards are marked in search results", async () => {
  const fake = installFakeScryfall();
  try {
    const all = JSON.parse(JSON.stringify(DEMO_SUBMISSION)) as SubmittedDeck;
    const names = all.cards.map((c) => c.name).filter((n) => n !== "Phyrexian Arena");
    const seen: string[] = [];
    let turn = 0;
    const caller: ModelCaller = async (params) => {
      turn++;
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const r of last.content) if (r.type === "tool_result") seen.push(String(r.content));
      if (turn === 1) return { content: [{ type: "tool_use", id: "q", name: "search_cards", input: { query: "x" } }], stop_reason: "tool_use" };
      const deck = JSON.parse(JSON.stringify(DEMO_SUBMISSION)) as SubmittedDeck;
      if (turn > 2) deck.cards = deck.cards.map((c) => (c.name === "Phyrexian Arena" ? { name: "Cruel Celebrant", role: "synergy", why: "x" } : c));
      return { content: [{ type: "tool_use", id: `s${turn}`, name: "submit_deck", input: deck }], stop_reason: "tool_use" };
    };
    const out = await runAgent(
      { seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any", collection: { names: [...names, "Cruel Celebrant", "Meren of Clan Nel Toth"], mode: "only" } },
      { model: "m", callModel: caller, emit: () => {} },
    );
    assert.match(seen[0], /Blood Artist \|[^\n]*OWNED/, "search results mark owned cards");
    assert.match(seen[1], /REJECTED[\s\S]*1 card\(s\) aren't in the user's collection: Phyrexian Arena/);
    assert.ok(out?.validation.ok);
    assert.ok(out!.deck.cards.some((c) => c.name === "Cruel Celebrant"));
  } finally {
    fake.restore();
  }
});

test("review fixes: own keys are opt-in next to a server key; Dragon Shield CSV; wording; size cap", async () => {
  const { serverConfig } = await import("../lib/server/config");
  process.env.ANTHROPIC_API_KEY = "sk-ant-server-" + "z".repeat(30);
  try {
    assert.equal(serverConfig().ownKeys, false, "an access-code deployment doesn't open up on update");
    process.env.OWN_KEYS = "1";
    assert.equal(serverConfig().ownKeys, true);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OWN_KEYS;
  }
  assert.equal(serverConfig().ownKeys, true, "on by default without a server key");

  const dragon = `"sep=,"\nQuantity,Trade Quantity,Card Name,Set Code,Set Name\n1,0,Sol Ring,CMR,Commander Legends\n2,0,"Fire // Ice",MH2,Modern Horizons 2`;
  assert.deepEqual(parseCollection(dragon).names, ["Sol Ring", "Fire // Ice"]);
  const titled = `My collection export\nCount,Name,Edition\n1,Counterspell,7ED`;
  assert.deepEqual(parseCollection(titled).names, ["Counterspell"]);

  assert.match(friendlyModelError(new ModelError("Claude API 400: Your credit balance is too low", 400), false), /This site's Claude API account/);
  assert.match(friendlyModelError(new ModelError("Claude API 400: max_tokens: 16000 > 4096", 400)), /recommended models/);

  const big = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { "content-length": "2000000" }, body: "{}" }));
  assert.equal(big.status, 413);
});

test("parseRequest: upgrade mode needs a commander and a finished deck's cards", () => {
  const cards = Array.from({ length: 62 }, (_, k) => `Card ${k}`);
  const r = parseRequest({ mode: "upgrade", seeds: cards, commander: "Meren of Clan Nel Toth", basics: { Swamp: 18, Forest: 19, Nonsense: 3 }, budget: "mid", bracket: 2 });
  assert.ok(typeof r !== "string", String(r));
  assert.equal(r.mode, "upgrade");
  assert.deepEqual(r.basics, { Swamp: 18, Forest: 19 });
  assert.match(String(parseRequest({ mode: "upgrade", seeds: cards, commander: null, budget: "any" })), /needs a commander/);
  assert.match(String(parseRequest({ mode: "upgrade", seeds: cards.slice(0, 10), commander: "Meren of Clan Nel Toth", budget: "any" })), /30 to 99/);
});

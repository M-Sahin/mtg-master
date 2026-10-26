import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SEEDS, DEMO_SUBMISSION } from "../lib/server/demo";
import { toCardInfo } from "../lib/server/scryfall";
import { resolveShared, payloadToSubmission } from "../lib/server/shared-deck";
import { buildDeck, namesInSubmission } from "../lib/server/validate";
import { decodePayload, encodeDeck, encodePayload, MAX_PARAM, toPayload } from "../lib/shared/share";
import { redditPost, shareTargets } from "../lib/shared/share-targets";
import { installFakeScryfall, lookupFake } from "./fixtures";

function demoDeck() {
  const sub = JSON.parse(JSON.stringify(DEMO_SUBMISSION));
  const found = new Map();
  for (const n of namesInSubmission(sub)) found.set(n.toLowerCase(), toCardInfo(lookupFake(n)));
  return buildDeck(sub, found, DEMO_SEEDS);
}

test("share link round-trips the whole deck and stays short enough", async () => {
  const deck = demoDeck();
  const d = await encodeDeck(deck);
  assert.match(d, /^[A-Za-z0-9_-]+$/);
  assert.ok(d.length < 2200, `link payload is ${d.length} chars`);
  const p = await decodePayload(d);
  assert.equal(p.n, deck.name);
  assert.equal(p.c, "Meren of Clan Nel Toth");
  assert.equal(p.cs, true);
  const total = 1 + p.k.reduce((n, [, , q = 1]) => n + q, 0);
  assert.equal(total, 100);
  assert.deepEqual(p.w, deck.winConditions);
  const forest = p.k.find(([n]) => n === "Forest");
  assert.equal(forest?.[2], 10);
  assert.equal(p.e?.length, 4); // four seeds in the 99, plus the commander
});

test("broken, oversized and foreign links are rejected with a readable message", async () => {
  await assert.rejects(decodePayload(""), /broken/);
  await assert.rejects(decodePayload("not base64!!"), /broken/);
  await assert.rejects(decodePayload("A".repeat(MAX_PARAM + 1)), /broken/);
  await assert.rejects(decodePayload("abcdef"), /broken/);
  const other = await encodePayload({ v: 99, n: "x", c: "y", k: [] } as any);
  await assert.rejects(decodePayload(other), /different version/);
  // a zip bomb: tiny link, huge JSON
  const bomb = await encodePayload({ v: 1, n: "x".repeat(200_000), c: "y", k: [] } as any);
  await assert.rejects(decodePayload(bomb), /too large|broken/);
});

test("decoding sanitises odd payloads", async () => {
  const d = await encodePayload({ v: 1, n: "N", c: " Meren of Clan Nel Toth ", k: [["Sol Ring", 42] as any, [123 as any, 1], ["Forest", 8, 10]], e: [0, 7] } as any);
  const p = await decodePayload(d);
  assert.equal(p.c, "Meren of Clan Nel Toth");
  assert.deepEqual(p.k.map((x) => x[0]), ["Sol Ring", "Forest"]);
  assert.equal(p.k[0][1], 9); // unknown role -> utility
  assert.deepEqual(p.e, [0]); // out-of-range seed index dropped
});

test("a shared link rebuilds into a valid deck with fresh card data", async () => {
  const fake = installFakeScryfall();
  try {
    const p = await decodePayload(await encodeDeck(demoDeck()));
    const { sub, seeds } = payloadToSubmission(p);
    assert.equal(sub.basics?.Forest, 10);
    assert.ok(seeds.includes("Meren of Clan Nel Toth") && seeds.includes("Viscera Seer"));
    const { deck, validation } = await resolveShared(p);
    assert.ok(validation.ok, validation.errors.join("\n"));
    assert.equal(validation.total, 100);
    assert.ok(deck.cards.every((c) => c.info));
    assert.equal(deck.cards.filter((c) => c.seed).length, 4);
  } finally {
    fake.restore();
  }
});

test("share targets and the Reddit post", () => {
  const url = "https://example.app/deck?d=abc";
  const t = Object.fromEntries(shareTargets({ url, title: "My deck: a Bracket 3 Commander deck" }).map((x) => [x.id, x.href]));
  assert.ok(t.whatsapp.startsWith("https://wa.me/?text="));
  assert.ok(decodeURIComponent(t.whatsapp).includes(url));
  assert.ok(t.reddit.startsWith("https://www.reddit.com/submit?url=" + encodeURIComponent(url)));
  assert.ok(t.telegram.includes(encodeURIComponent(url)));
  assert.ok(t.email.startsWith("mailto:?subject="));
  const post = redditPost(demoDeck(), url);
  assert.match(post, /^\*\*Meren's Endless Harvest\*\*/);
  assert.match(post, /\[Full list with card images\]\(https:\/\/example\.app\/deck\?d=abc\)/);
  assert.match(post, /\n {4}1 Meren of Clan Nel Toth\n/);
  assert.match(post, /\n {4}10 Forest\n/);
});

test("toPayload keeps the payload compact", () => {
  const p = toPayload(demoDeck());
  assert.ok(!("why" in (p as any)));
  assert.ok(p.k.every((x) => x.length <= 3));
});

// ---- short links (/api/share + store) ----
import { canonicalOrigin, handleShare } from "../lib/server/share-handler";
import { loadShare, shareId } from "../lib/server/store";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    old[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(old)) old[k] === undefined ? delete process.env[k] : (process.env[k] = old[k]);
  });
}

/** Fake Upstash REST endpoint backed by a Map. */
function fakeKv() {
  const data = new Map<string, string>();
  const seen: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith("https://kv.example")) return original(input, init);
    assert.equal(init.headers.authorization, "Bearer tok");
    const cmd = JSON.parse(init.body);
    seen.push(cmd);
    const [op, key, value] = cmd;
    let result: unknown = null;
    if (op === "SET") {
      data.set(key, value);
      result = "OK";
    } else if (op === "GETEX" || op === "GET") result = data.get(key) ?? null;
    return new Response(JSON.stringify({ result }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { data, seen, restore: () => (globalThis.fetch = original) };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://deckbuilder-abc123-msahin.vercel.app/api/share", { method: "POST", headers: { "content-type": "application/json", host: "deckbuilder-abc123-msahin.vercel.app", ...headers }, body: JSON.stringify(body) });

test("share links use the public production domain, not the (protected) deployment URL", async () => {
  await withEnv({ SITE_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: "deckbuilder-jet.vercel.app" }, async () => {
    assert.equal(canonicalOrigin(post({})), "https://deckbuilder-jet.vercel.app");
  });
  await withEnv({ SITE_URL: "https://hundredfoldz.example/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }, async () => {
    assert.equal(canonicalOrigin(post({})), "https://hundredfoldz.example");
  });
  await withEnv({ SITE_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined }, async () => {
    assert.equal(canonicalOrigin(new Request("http://localhost:3000/api/share", { headers: { host: "localhost:3000" } })), "http://localhost:3000");
  });
});

test("/api/share: long link without a store, short /d/<id> link with one, same id for the same deck", async () => {
  const d = await encodeDeck(demoDeck());
  await withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "deckbuilder-jet.vercel.app", SITE_URL: undefined, KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }, async () => {
    const r = await (await handleShare(post({ d }))).json();
    assert.equal(r.short, false);
    assert.equal(r.url, `https://deckbuilder-jet.vercel.app/deck?d=${d}`);
  });
  const kv = fakeKv();
  try {
    await withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "deckbuilder-jet.vercel.app", SITE_URL: undefined, KV_REST_API_URL: "https://kv.example/", KV_REST_API_TOKEN: "tok" }, async () => {
      const a = await (await handleShare(post({ d }, { "x-forwarded-for": "1.2.3.4" }))).json();
      const b = await (await handleShare(post({ d }, { "x-forwarded-for": "1.2.3.4" }))).json();
      assert.equal(a.short, true);
      assert.match(a.url, /^https:\/\/deckbuilder-jet\.vercel\.app\/d\/[0-9A-Za-z]{9}$/);
      assert.equal(a.url, b.url, "deterministic id");
      assert.ok(a.url.length < 50, a.url);
      const id = a.url.split("/d/")[1];
      assert.equal(id, await shareId(d));
      assert.equal(await loadShare(id), d);
      assert.equal(await loadShare("nope!"), null, "bad ids never reach the store");
      assert.equal(await loadShare("zzzzzzzzz"), null);
      const set = kv.seen.find((c: any[]) => c[0] === "SET")!;
      assert.deepEqual(set.slice(0, 1).concat(set.slice(3)), ["SET", "EX", 31536000]);
      // only real decks get stored
      const bad = await handleShare(post({ d: "garbage" }));
      assert.equal(bad.status, 400);
    });
  } finally {
    kv.restore();
  }
});

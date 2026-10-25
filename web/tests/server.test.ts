import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeStream, sseEvents, type ModelCaller } from "../lib/server/anthropic";
import { DraftScanner } from "../lib/server/draft-scanner";
import { DEMO_SEEDS, DEMO_SUBMISSION, demoCaller } from "../lib/server/demo";
import { handleGenerate, parseRequest } from "../lib/server/generate-handler";
import { sections, systemPrompt, userPrompt, TOOLS } from "../lib/server/prompt";
import { toCardInfo } from "../lib/server/scryfall";
import { buildDeck, namesInSubmission, repairCount, validateDeck, type SubmittedDeck } from "../lib/server/validate";
import { runAgent } from "../lib/server/agent";
import type { StreamEvent } from "../lib/shared/types";
import { installFakeScryfall, lookupFake } from "./fixtures";

function lookup(names: string[]) {
  const found = new Map();
  const notFound: string[] = [];
  for (const n of names) {
    const c = lookupFake(n);
    c ? found.set(n.toLowerCase(), toCardInfo(c)) : notFound.push(n);
  }
  return { found, notFound };
}

function check(sub: SubmittedDeck, seeds = DEMO_SEEDS) {
  const { found, notFound } = lookup(namesInSubmission(sub));
  const deck = buildDeck(sub, found, seeds);
  return { deck, v: validateDeck(deck, notFound, seeds) };
}

const clone = () => JSON.parse(JSON.stringify(DEMO_SUBMISSION)) as SubmittedDeck;

test("demo deck is exactly 100 cards and valid", () => {
  const { deck, v } = check(clone());
  assert.equal(v.total, 100, v.errors.join("\n"));
  assert.deepEqual(v.errors, []);
  assert.ok(v.ok);
  assert.deepEqual(deck.colorIdentity, ["B", "G"]);
  assert.equal(deck.cards.find((c) => c.name === "Forest")?.qty, 10);
  assert.ok(deck.cards.filter((c) => c.seed).length === 4 && deck.commander.seed);
});

test("count errors say how many to add/remove", () => {
  const s = clone();
  s.cards.pop();
  assert.match(check(s).v.errors.join(), /99 cards.*add 1/);
  const s2 = clone();
  s2.basics = { Forest: 12, Swamp: 10 };
  assert.match(check(s2).v.errors.join(), /102 cards.*remove 2/);
});

test("singleton, banned, off-color, unknown, missing seed", () => {
  const s = clone();
  s.cards = s.cards.filter((c) => c.name !== "Sakura-Tribe Elder" && c.name !== "Cultivate" && c.name !== "Rampant Growth" && c.name !== "Nature's Lore");
  s.cards.push({ name: "Sol Ring", role: "ramp", why: "" }, { name: "Mana Crypt", role: "ramp", why: "" }, { name: "Lightning Bolt", role: "removal", why: "" }, { name: "Not A Real Card", role: "utility", why: "" });
  const e = check(s).v.errors.join("\n");
  assert.match(e, /2 copies of Sol Ring/);
  assert.match(e, /Mana Crypt is BANNED/);
  assert.match(e, /Lightning Bolt \(R\) is outside/);
  assert.match(e, /"Not A Real Card" was not found/);
  assert.match(e, /Seed card "Sakura-Tribe Elder" is missing/);
});

test("any-number cards are allowed in multiples", () => {
  const s = clone();
  s.cards.splice(0, 2, { name: "Relentless Rats", role: "synergy", why: "" }, { name: "Relentless Rats", role: "synergy", why: "" });
  s.cards.push({ name: "Sakura-Tribe Elder", role: "ramp", why: "" }); // put the seed back
  s.basics = { Forest: 9, Swamp: 10 };
  assert.ok(!check(s).v.errors.some((x) => x.includes("Relentless Rats")), check(s).v.errors.join());
});

test("more than 3 Game Changers is an error; 3 is fine", () => {
  const s = clone();
  const gcs = ["Demonic Tutor", "Vampiric Tutor", "Necropotence", "Bolas's Citadel"];
  s.cards.splice(11, 4, ...gcs.map((name) => ({ name, role: "utility", why: "" })));
  const { v } = check(s);
  assert.match(v.errors.join(), /4 Game Changers.*at most 3/);
  assert.equal(v.gameChangers.length, 4);
  s.cards.splice(11, 1, { name: "Grim Haruspex", role: "draw", why: "" });
  assert.ok(!check(s).v.errors.some((x) => x.includes("Game Changers")));
});

test("mass land denial is flagged as a warning", () => {
  const s = clone();
  s.cards.splice(12, 1, { name: "Armageddon", role: "wipe", why: "" });
  const { v } = check(s);
  assert.ok(v.warnings.some((w) => w.includes("Armageddon")));
});

test("a non-legendary commander is rejected", () => {
  const s = clone();
  s.commander = "Llanowar Elves";
  assert.match(check(s, []).v.errors.join(), /can't be a commander/);
});

test("repairCount fixes small count errors with basics", () => {
  const s = clone();
  s.basics = { Forest: 8, Swamp: 9 };
  const { deck } = check(s);
  assert.ok(repairCount(deck));
  assert.equal(1 + deck.cards.reduce((n, c) => n + c.qty, 0), 100);
  const big = clone();
  big.basics = {};
  assert.equal(repairCount(check(big).deck), null); // 20 off: don't paper over it
});

test("DraftScanner emits cards as their objects complete", () => {
  const json = JSON.stringify(DEMO_SUBMISSION);
  const sc = new DraftScanner();
  let got: string[] = [];
  for (let i = 1; i <= json.length; i += 37) got = got.concat(sc.feed(json.slice(0, i)).map((c) => c.name));
  got = got.concat(sc.feed(json).map((c) => c.name));
  assert.equal(got.length, DEMO_SUBMISSION.cards.length);
  assert.equal(got[0], DEMO_SUBMISSION.cards[0].name);
  assert.equal(sc.meta.commander, "Meren of Clan Nel Toth");
  assert.equal(sc.meta.deckName, DEMO_SUBMISSION.deck_name);
});

test("DraftScanner copes with braces and quotes inside strings", () => {
  const sc = new DraftScanner();
  const out = sc.feed('{"cards":[{"name":"Odd {Card}","role":"ramp","why":"says \\"hi\\" }"},{"name":"Two","role":"draw","why":"x"}]}');
  assert.deepEqual(out.map((c) => c.name), ["Odd {Card}", "Two"]);
});

test("SSE parser handles arbitrary chunk boundaries and CRLF", async () => {
  const raw =
    'event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\r\n\r\n' +
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}\n\n' +
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"get_cards","input":{}}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"names\\":[\\"Sol"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" Ring\\"]}"}}\n\n' +
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n' +
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const bytes = new TextEncoder().encode(raw);
  for (const size of [1, 7, 64, bytes.length]) {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
        c.close();
      },
    });
    let text = "";
    const msg = await consumeStream(sseEvents(body), { onText: (d) => (text += d) });
    assert.equal(text, "Hello world");
    assert.equal(msg.stop_reason, "tool_use");
    assert.deepEqual((msg.content[1] as any).input, { names: ["Sol Ring"] });
    assert.equal(msg.usage?.output_tokens, 9);
  }
});

test("system prompt is built from the skill files", () => {
  const p = systemPrompt();
  assert.match(p, /<skill name="mtg-master" version="\d+\.\d+\.\d+">/);
  assert.match(p, /verify, don't recall/);
  assert.match(p, /Commander \/ EDH/); // commander.md
  assert.match(p, /1CC \(turn 3\)/); // Karsten table from constructed.md §3
  assert.match(p, /otag:ramp/); // lookup.md §3
  assert.match(p, /CR 903/); // rules.md §9
  assert.doesNotMatch(p, /^---\nname:/m); // frontmatter stripped
  assert.doesNotMatch(p, /## 5\. Sideboards/); // only the sections we asked for
  assert.match(p, /up to three Game Changers/i);
  assert.equal(sections("## 1. A\nx\n## 2. B\ny\n## 3. C\nz", [2]), "## 2. B\ny");
  assert.deepEqual(TOOLS.map((t) => t.name), ["search_cards", "get_cards", "submit_deck"]);
  const up = userPrompt({ seeds: DEMO_SEEDS, commander: null, budget: "budget", theme: "zombies" }, DEMO_SEEDS.map((n) => toCardInfo(lookupFake(n))));
  assert.match(up, /not chosen/);
  assert.match(up, /under ~€75/);
  assert.match(up, /zombies/);
});

test("parseRequest validates input", () => {
  assert.equal(typeof parseRequest({ seeds: ["a", "b"] }), "string");
  assert.equal(typeof parseRequest({ seeds: ["a", "a", "b", "c", "d"] }), "string");
  assert.equal(typeof parseRequest({ seeds: ["a", "b", "c", "d", "e"], commander: "z" }), "string");
  const ok = parseRequest({ seeds: ["a", "b", "c", "d", "e"], commander: "c", budget: "lol" });
  assert.deepEqual(ok, { seeds: ["a", "b", "c", "d", "e"], commander: "c", budget: "any", theme: undefined });
});

async function collect(res: Response) {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as StreamEvent);
}

test("end to end in demo mode: streams progress, draft cards and a valid deck", async () => {
  const fake = installFakeScryfall();
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const req = new Request("http://x/api/generate", { method: "POST", body: JSON.stringify({ seeds: DEMO_SEEDS, commander: null, budget: "any" }) });
    const events = await collect(await handleGenerate(req, { demoSpeed: 0 }));
    const types = events.map((e) => e.type);
    assert.ok(types.includes("text") && types.includes("tool") && types.includes("tool_result"));
    assert.equal(events.filter((e) => e.type === "tool").length, 4); // get_cards + 3 searches
    assert.equal(events.filter((e) => e.type === "draft_card").length, DEMO_SUBMISSION.cards.length);
    const deck = events.find((e) => e.type === "deck") as Extract<StreamEvent, { type: "deck" }>;
    assert.ok(deck, "deck event");
    assert.ok(deck.validation.ok, deck.validation.errors.join("\n"));
    assert.equal(deck.validation.total, 100);
    assert.equal(deck.deck.commander.name, "Meren of Clan Nel Toth");
    assert.ok(deck.deck.cards.every((c) => c.info?.image), "every card has Scryfall data");
    assert.equal(types.at(-1), "done");
  } finally {
    fake.restore();
  }
});

test("demo mode refuses other seeds; access code is enforced in live mode", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let res = await handleGenerate(new Request("http://x", { method: "POST", body: JSON.stringify({ seeds: ["a", "b", "c", "d", "e"] }) }));
  assert.equal(res.status, 400);
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    res = await handleGenerate(new Request("http://x", { method: "POST", body: "{}" }));
    assert.equal(res.status, 503); // key but no access code: refuse rather than open the wallet
    process.env.ACCESS_CODE = "open-sesame";
    res = await handleGenerate(new Request("http://x", { method: "POST", body: "{}" }));
    assert.equal(res.status, 401);
    res = await handleGenerate(new Request("http://x", { method: "POST", headers: { "x-access-code": "open-sesame" }, body: "{}" }));
    assert.equal(res.status, 400); // past the gate, fails on body validation
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ACCESS_CODE;
  }
});

test("agent feeds validation errors back to Claude and accepts the fixed deck", async () => {
  const fake = installFakeScryfall();
  try {
    const bad = clone();
    bad.cards.pop(); // 99
    bad.cards.push({ name: "Lightning Bolt", role: "removal", why: "" }); // off-color
    const turns = [bad, clone()];
    const seenResults: string[] = [];
    const caller: ModelCaller = async (params, h) => {
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const r of last.content) if (r.type === "tool_result") seenResults.push(String(r.content));
      const input = turns.shift();
      const id = `t${turns.length}`;
      h.onToolStart?.(0, id, "submit_deck");
      h.onToolInput?.(0, "submit_deck", JSON.stringify(input));
      return { content: [{ type: "tool_use", id, name: "submit_deck", input }], stop_reason: "tool_use" };
    };
    const events: StreamEvent[] = [];
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any" }, { model: "m", callModel: caller, emit: (e) => events.push(e) });
    assert.ok(out?.validation.ok);
    const vals = events.filter((e) => e.type === "validation") as Extract<StreamEvent, { type: "validation" }>[];
    assert.equal(vals.length, 2);
    assert.ok(!vals[0].validation.ok);
    assert.match(seenResults.join(), /REJECTED[\s\S]*Lightning Bolt/);
  } finally {
    fake.restore();
  }
});

test("agent nudges once when Claude stops without submitting, and reports failure", async () => {
  const fake = installFakeScryfall();
  try {
    let calls = 0;
    const caller: ModelCaller = async () => {
      calls++;
      return { content: [{ type: "text", text: "hmm" }], stop_reason: "end_turn" };
    };
    const events: StreamEvent[] = [];
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: null, budget: "any" }, { model: "m", callModel: caller, emit: (e) => events.push(e) });
    assert.equal(out, null);
    assert.equal(calls, 2);
    assert.ok(events.some((e) => e.type === "error"));
  } finally {
    fake.restore();
  }
});

test("search tool results and failures reach Claude as text", async () => {
  const fake = installFakeScryfall();
  try {
    const results: any[] = [];
    let turn = 0;
    const caller: ModelCaller = async (params) => {
      turn++;
      if (turn === 2) results.push(...params.messages.at(-1).content);
      if (turn === 1)
        return {
          content: [
            { type: "tool_use", id: "a", name: "search_cards", input: { query: "id<=bg f:commander otag:ramp" } },
            { type: "tool_use", id: "b", name: "search_cards", input: { query: "nothingmatches" } },
            { type: "tool_use", id: "c", name: "get_cards", input: { names: ["Sol Ring", "Not A Real Card"] } },
          ],
          stop_reason: "tool_use",
        };
      return { content: [{ type: "tool_use", id: "d", name: "submit_deck", input: clone() }], stop_reason: "tool_use" };
    };
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: null, budget: "any" }, { model: "m", callModel: caller, emit: () => {} });
    assert.ok(out?.validation.ok);
    assert.match(results[0].content, /2 total matches[\s\S]*Blood Artist/);
    assert.match(results[1].content, /No results/);
    assert.match(results[2].content, /Sol Ring[\s\S]*NOT FOUND: Not A Real Card/);
  } finally {
    fake.restore();
  }
});

test("seed problems stop the run early with a clear message", async () => {
  const fake = installFakeScryfall();
  try {
    const events: StreamEvent[] = [];
    const out = await runAgent({ seeds: ["Mana Crypt", "Not A Real Card", "Sol Ring", "Viscera Seer", "Grim Haruspex"], commander: null, budget: "any" }, { model: "m", callModel: demoCaller(0), emit: (e) => events.push(e) });
    assert.equal(out, null);
    const err = events.find((e) => e.type === "error") as any;
    assert.match(err.message, /Not A Real Card/);
    assert.match(err.message, /Mana Crypt is banned/);
  } finally {
    fake.restore();
  }
});

test("rate limiter allows N builds per hour per IP", async () => {
  const { rateLimited } = await import("../lib/server/generate-handler");
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimited("1.2.3.4", 3, t + i), false);
  assert.equal(rateLimited("1.2.3.4", 3, t + 10), true);
  assert.equal(rateLimited("5.6.7.8", 3, t + 10), false);
  assert.equal(rateLimited("1.2.3.4", 3, t + 3_600_100), false);
});

test("the user's chosen commander is enforced", () => {
  const s = clone();
  const { found, notFound } = lookup(namesInSubmission(s));
  const v = validateDeck(buildDeck(s, found, DEMO_SEEDS), notFound, DEMO_SEEDS, { commander: "Grim Haruspex" });
  assert.match(v.errors.join(), /user chose Grim Haruspex/);
});

test("partner pairing rules", async () => {
  const { pairingProblem } = await import("../lib/server/validate");
  const c = (name: string, oracleText: string, typeLine = "Legendary Creature — Human") => ({ ...toCardInfo(lookupFake(name)), name, oracleText, typeLine });
  const thrasios = c("Thrasios", "{4}: Scry 1.\nPartner (You can have two commanders if both have partner.)");
  const tymna = c("Tymna", "Lifelink\nPartner (You can have two commanders if both have partner.)");
  const atraxa = c("Atraxa", "Flying, vigilance");
  assert.equal(pairingProblem(thrasios, tymna), null);
  assert.ok(pairingProblem(thrasios, atraxa));
  const pir = c("Pir, Imaginative Rascal", "Partner with Toothy, Imaginary Friend (When this creature enters, ...)");
  const toothy = c("Toothy, Imaginary Friend", "Partner with Pir, Imaginative Rascal (When this creature enters, ...)");
  assert.equal(pairingProblem(pir, toothy), null);
  assert.ok(pairingProblem(pir, tymna));
  const wilson = c("Wilson, Refined Grizzly", "Choose a Background (You can have a Background as a second commander.)");
  const bg = c("Raised by Giants", "Commander creatures you own have base power and toughness 10/10.", "Legendary Enchantment — Background");
  assert.equal(pairingProblem(wilson, bg), null);
  assert.ok(pairingProblem(tymna, bg));
});

test("unverified names can't slip through validation", () => {
  const s = clone();
  const { found, notFound } = lookup(namesInSubmission(s));
  found.delete("sol ring"); // Scryfall answered under a different spelling and we lost it
  const v = validateDeck(buildDeck(s, found, DEMO_SEEDS), notFound, DEMO_SEEDS);
  assert.match(v.errors.join(), /Couldn't verify "Sol Ring"/);
});

test("agent: deadline returns the best deck so far; truncated submit is retried", async () => {
  const fake = installFakeScryfall();
  try {
    let calls = 0;
    const caller: ModelCaller = async (params) => {
      calls++;
      if (calls === 1) return { content: [{ type: "tool_use", id: "x", name: "submit_deck", input: { __invalid_json: '{"cards":[' } }], stop_reason: "max_tokens" };
      assert.equal(params.max_tokens, 32000);
      await new Promise((r) => setTimeout(r, 120)); // "Claude" takes a while; the deadline passes
      const bad = clone();
      bad.cards.pop();
      return { content: [{ type: "tool_use", id: `s${calls}`, name: "submit_deck", input: bad }], stop_reason: "tool_use" };
    };
    const events: StreamEvent[] = [];
    // hard deadline so short that only one real submission fits
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: null, budget: "any" }, { model: "m", callModel: caller, emit: (e) => events.push(e), hardDeadlineMs: 15_100 });
    assert.equal(calls, 2, "no third turn after the deadline");
    assert.ok(out, "returns the last deck even though it has errors");
    assert.equal(out!.validation.ok, false);
    assert.ok(events.some((e) => e.type === "status" && /cut off/.test(e.text)));
  } finally {
    fake.restore();
  }
});

test("agent: parallel submits in one turn are handled one at a time, extra lookups are capped", async () => {
  const fake = installFakeScryfall();
  try {
    let turn = 0;
    const seen: any[] = [];
    const caller: ModelCaller = async (params) => {
      turn++;
      if (turn === 2) seen.push(...params.messages.at(-1).content);
      if (turn === 1)
        return {
          content: [
            ...Array.from({ length: 8 }, (_, i) => ({ type: "tool_use" as const, id: `q${i}`, name: "search_cards", input: { query: `x${i}` } })),
            { type: "tool_use", id: "bad", name: "submit_deck", input: (() => { const b = clone(); b.cards.pop(); return b; })() },
            { type: "tool_use", id: "good", name: "submit_deck", input: clone() },
          ],
          stop_reason: "tool_use",
        };
      return { content: [{ type: "tool_use", id: "fin", name: "submit_deck", input: clone() }], stop_reason: "tool_use" };
    };
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: null, budget: "any" }, { model: "m", callModel: caller, emit: () => {} });
    assert.ok(out?.validation.ok);
    const byId = Object.fromEntries(seen.map((r: any) => [r.tool_use_id, r]));
    assert.match(byId.q7.content, /Skipped/);
    assert.match(byId.bad.content, /REJECTED/);
    assert.match(byId.good.content, /Only one submit_deck per turn/);
    assert.equal(seen.length, 10); // every tool_use got exactly one result
  } finally {
    fake.restore();
  }
});

test("stream that ends without message_stop is an error", async () => {
  async function* ev() {
    yield { event: "message_start", data: '{"type":"message_start","message":{}}' };
    yield { event: "content_block_start", data: '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}' };
  }
  await assert.rejects(consumeStream(ev(), {}), /ended early/);
});

test("double-faced cards resolve by full 'Front // Back' name and by front face", async () => {
  const fake = installFakeScryfall();
  try {
    const { getCollection } = await import("../lib/server/scryfall");
    const full = "Ojer Axonil, Deepest Might // Temple of Power";
    const { found, notFound } = await getCollection([full, "Temple of Power", "Sol Ring", "Not A Real Card"]);
    assert.deepEqual(notFound, ["Not A Real Card"]);
    assert.equal(found.get(full.toLowerCase())?.name, full);
    assert.equal(found.get("temple of power")?.name, full);
    // the collection request asked for the front face, not the full name
    assert.ok(!fake.calls.some((u) => u.includes("Temple%20of%20Power") && u.includes("collection")));
  } finally {
    fake.restore();
  }
});

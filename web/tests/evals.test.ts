// The eval harness pieces that don't need the network: scoring, judging logic, the report.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelCaller } from "../lib/server/anthropic";
import { runAgent } from "../lib/server/agent";
import { DEMO_SEEDS, demoCaller } from "../lib/server/demo";
import type { StreamEvent } from "../lib/shared/types";
import { decklistForJudge, judgePair, parseVerdict } from "../evals/judge";
import { renderReport } from "../evals/report";
import { aggregate, costUsd, scoreBuild, type Hand } from "../evals/score";
import { installFakeScryfall } from "./fixtures";
import hands from "../evals/hands.json";

const hand: Hand = { id: "meren", seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any" };

test("hands.json: 20 well-formed hands with unique ids", () => {
  const hs = hands as Hand[];
  assert.equal(hs.length, 20);
  assert.equal(new Set(hs.map((h) => h.id)).size, 20);
  for (const h of hs) {
    assert.equal(h.seeds.length, 5, h.id);
    assert.equal(new Set(h.seeds.map((s) => s.toLowerCase())).size, 5, h.id);
    if (h.commander) assert.ok(h.seeds.includes(h.commander), `${h.id}: commander must be a seed`);
    assert.ok(["any", "mid", "budget"].includes(h.budget));
  }
});

test("costUsd uses per-model prices", () => {
  const u = { calls: 1, input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 };
  assert.equal(costUsd("claude-sonnet-5-5", u), 2 + 1 + 0.1);
  assert.equal(costUsd("unknown-model", u), null);
});

test("scoreBuild and aggregate on a real agent run (demo caller, fake Scryfall)", async () => {
  const fake = installFakeScryfall();
  try {
    const events: StreamEvent[] = [];
    const result = await runAgent({ seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any" }, { model: "m", callModel: demoCaller(0), emit: (e) => events.push(e) });
    const s = scoreBuild({ hand, variant: "v1", run: 1, model: "claude-sonnet-5-5", ms: 1234, events, result, combos: null });
    assert.ok(s.ok);
    assert.equal(s.seedsInDeck, 5);
    assert.equal(s.submits, 1);
    assert.ok(s.searches >= 1);
    const failed = scoreBuild({ hand, variant: "v2", run: 1, model: "claude-sonnet-5-5", ms: 50, events: [{ type: "error", message: "boom" }], result: null, combos: null });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, "boom");
    const a = aggregate("v1", [s, failed]);
    assert.equal(a.builds, 1);
    assert.equal(a.okRate, 1);
    const b = aggregate("v2", [s, failed]);
    assert.equal(b.okRate, 0);
    const md = renderReport({ meta: { model: "m", judge: "j", variants: ["v1", "v2"], hands: ["meren"], repeat: 1, date: new Date().toISOString() }, aggregates: [a, b], scores: [s, failed], pairs: [] });
    assert.match(md, /\| v1 \| 1 \| 100% \|/);
    assert.match(md, /\*\*failed\*\*: boom/);
    // the judge sees a typed decklist without strategy text
    const list = decklistForJudge(result!.deck);
    assert.match(list, /^Commander: Meren of Clan Nel Toth/);
    assert.match(list, /Land \(\d+\):/);
    assert.ok(!list.includes(result!.deck.strategy.slice(0, 30)));
  } finally {
    fake.restore();
  }
});

test("judge: parses verdicts; a win needs both orders to agree", async () => {
  assert.deepEqual(parseVerdict('Sure. {"winner":"2","reasons":"x"}')?.winner, "2");
  assert.equal(parseVerdict("no json"), null);
  assert.equal(parseVerdict('{"winner":"3"}'), null);

  const deckA = { name: "A", commander: { name: "A", qty: 1, role: "wincon", why: "" }, cards: [], strategy: "", winConditions: [], bracketNotes: "", colorIdentity: [] } as any;
  const deckB = { ...deckA, name: "B", commander: { ...deckA.commander, name: "B" } };
  const reply = (text: string) => ({ content: [{ type: "text" as const, text }], stop_reason: "end_turn" });
  // judge that always prefers whichever deck is shown first: position bias -> tie
  const biased: ModelCaller = async () => reply('{"winner":"1","scores":{"1":{"fun":8},"2":{"fun":6}}}');
  const p1 = await judgePair(biased, "j", hand, { variant: "v1", deck: deckA }, { variant: "v2", deck: deckB });
  assert.equal(p1.winner, "tie");
  assert.equal(p1.agree, false);
  assert.equal(p1.scores?.v1.fun, 7);
  // judge that always prefers deck B, wherever it is shown
  const prefersB: ModelCaller = async (params) => {
    const text = String(params.messages[0].content);
    const firstIsB = text.indexOf("Commander: B") < text.indexOf("Commander: A");
    return reply(`{"winner":"${firstIsB ? "1" : "2"}"}`);
  };
  const p2 = await judgePair(prefersB, "j", hand, { variant: "v1", deck: deckA }, { variant: "v2", deck: deckB });
  assert.equal(p2.winner, "v2");
  assert.ok(p2.agree);
});

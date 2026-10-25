// Building for brackets 1–4, and completing a deck the user started.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelCaller } from "../lib/server/anthropic";
import { runAgent } from "../lib/server/agent";
import { resetComboCache } from "../lib/server/combos";
import { DEMO_SEEDS, DEMO_SUBMISSION } from "../lib/server/demo";
import { parseEngine } from "../lib/server/engine";
import { systemPrompt, userPrompt } from "../lib/server/prompt";
import { toCardInfo } from "../lib/server/scryfall";
import { buildDeck, namesInSubmission, validateDeck, type SubmittedDeck } from "../lib/server/validate";
import { installFakeScryfall, lookupFake, spellbook } from "./fixtures";

const clone = () => JSON.parse(JSON.stringify(DEMO_SUBMISSION)) as SubmittedDeck;
function check(sub: SubmittedDeck, seeds: string[], bracket: number) {
  const found = new Map();
  for (const n of namesInSubmission(sub)) found.set(n.toLowerCase(), toCardInfo(lookupFake(n)));
  const deck = buildDeck(sub, found, seeds);
  return validateDeck(deck, [], seeds, { bracket });
}

test("system prompts follow the bracket; bracket 3 is unchanged", () => {
  assert.equal(systemPrompt(parseEngine("v1"), 3), systemPrompt(parseEngine("v1")));
  assert.match(systemPrompt(parseEngine("v1"), 1), /Bracket 1 \(Exhibition\)[\s\S]*No Game Changers/);
  assert.match(systemPrompt(parseEngine("v2"), 4), /Bracket 4 \(Optimized\)[\s\S]*this bracket has no limit/);
  assert.ok(!systemPrompt(parseEngine("v2"), 4).includes("Don't put two-card infinite combos"));
});

test("Game Changer limits per bracket; the user's own picks don't count against it", () => {
  const sub = clone();
  sub.cards.splice(1, 2, { name: "Demonic Tutor", role: "utility", why: "" }, { name: "Vampiric Tutor", role: "utility", why: "" });
  const b2 = check(sub, DEMO_SEEDS, 2);
  assert.ok(b2.errors.some((e) => /2 Game Changers \(Demonic Tutor, Vampiric Tutor\): Bracket 2 allows none/.test(e)));
  assert.ok(check(sub, DEMO_SEEDS, 3).ok);
  assert.ok(check(sub, DEMO_SEEDS, 4).ok);
  // a seed that is a Game Changer: warned, not an error
  const own = check(sub, [...DEMO_SEEDS, "Demonic Tutor", "Vampiric Tutor"], 1);
  assert.ok(own.ok, own.errors.join(" | "));
  assert.ok(own.warnings.some((w) => /Your own cards include 2 Game Changer/.test(w)));
});

test("bracket 2 build: any two-card combo goes back to Claude; the deck records its bracket", async () => {
  const fake = installFakeScryfall();
  resetComboCache();
  spellbook.body = (req: any) => ({ results: { included: req.main.some((m: any) => m.card === "Ashnod's Altar") ? [{ id: "x", uses: [{ card: { name: "Ashnod's Altar" } }, { card: { name: "Sol Ring" } }], produces: [{ feature: { name: "Infinite mana" } }], bracketTag: "P" }] : [] } });
  try {
    const seen: string[] = [];
    let turn = 0;
    const caller: ModelCaller = async (params) => {
      turn++;
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const r of last.content) if (r.type === "tool_result") seen.push(String(r.content));
      const deck = clone();
      if (turn > 1) deck.cards = deck.cards.map((c) => (c.name === "Ashnod's Altar" ? { name: "Night's Whisper", role: "draw", why: "x" } : c));
      return { content: [{ type: "tool_use", id: `s${turn}`, name: "submit_deck", input: deck }], stop_reason: "tool_use" };
    };
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any", bracket: 2 }, { model: "m", callModel: caller, emit: () => {} });
    assert.match(seen[0], /REJECTED[\s\S]*Ashnod's Altar \+ Sol Ring is a two-card combo[\s\S]*Bracket 2 decks have none/);
    assert.ok(out?.validation.ok);
    assert.equal(out!.deck.bracket, 2);
  } finally {
    spellbook.body = { results: { included: [] } };
    fake.restore();
  }
});

test("complete my deck: the user's cards all stay, the commander comes from their list", async () => {
  const fake = installFakeScryfall();
  try {
    const full = clone();
    const keep = full.cards.slice(0, 40).map((c) => c.name);
    const seen: { prompt?: string; results: string[] } = { results: [] };
    let turn = 0;
    const caller: ModelCaller = async (params) => {
      turn++;
      if (turn === 1) { const c0 = params.messages[0].content; seen.prompt = typeof c0 === "string" ? c0 : c0.map((b: any) => b.text ?? "").join("\n"); }
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const r of last.content) if (r.type === "tool_result") seen.results.push(String(r.content));
      const deck = clone();
      if (turn === 1) deck.cards = deck.cards.filter((c) => c.name !== keep[3]).concat([{ name: "Night's Whisper", role: "draw", why: "x" }]); // drops one of the user's cards
      return { content: [{ type: "tool_use", id: `s${turn}`, name: "submit_deck", input: deck }], stop_reason: "tool_use" };
    };
    const out = await runAgent(
      { mode: "complete", seeds: keep, commander: "Meren of Clan Nel Toth", basics: { Forest: 5 }, budget: "any", bracket: 3 },
      { model: "m", callModel: caller, emit: () => {} },
    );
    assert.match(seen.prompt!, /COMPLETE A DECK[\s\S]*Commander: Meren of Clan Nel Toth[\s\S]*has 46 of 100 cards\. Add exactly 54 more/);
    assert.match(seen.prompt!, /Basic lands already in the deck: 5 Forest/);
    assert.match(seen.results[0], new RegExp(`REJECTED[\\s\\S]*"${keep[3].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" from the user's deck is missing`));
    assert.ok(out?.validation.ok);
    for (const k of keep) assert.ok(out!.deck.cards.some((c) => c.name === k), `${k} stays`);
  } finally {
    fake.restore();
  }
});

test("the complete prompt replaces the five-seed task", () => {
  const cards = ["Sol Ring", "Viscera Seer", "Meren of Clan Nel Toth"].map((n) => toCardInfo(lookupFake(n)));
  const p = userPrompt({ mode: "complete", seeds: ["Sol Ring", "Viscera Seer"], commander: "Meren of Clan Nel Toth", budget: "budget", bracket: 2 }, cards);
  assert.match(p, /Bracket 2 \(Core\)/);
  assert.match(p, /- Sol Ring[\s\S]*- Viscera Seer/);
  assert.ok(!p.includes("- Meren of Clan Nel Toth"), "the commander isn't listed as one of the 99");
  assert.match(p, /has 3 of 100 cards\. Add exactly 97 more/);
});

test("upgrade my deck: one review round of swaps on the user's deck; only revise_deck is offered", async () => {
  const fake = installFakeScryfall();
  try {
    const full = clone();
    const names = full.cards.map((c) => c.name);
    const cut = names.find((n) => n !== "Sol Ring")!;
    const seen: { prompt?: string; tools?: string[]; results: string[] } = { results: [] };
    let turn = 0;
    const caller: ModelCaller = async (params) => {
      turn++;
      if (turn === 1) {
        const c0 = params.messages[0].content;
        seen.prompt = typeof c0 === "string" ? c0 : c0.map((b: any) => b.text ?? "").join("\n");
        seen.tools = (params.tools ?? []).map((t: any) => t.name);
      }
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const r of last.content) if (r.type === "tool_result") seen.results.push(String(r.content));
      // first a swap that names a card the deck doesn't have, then a good one
      const swaps = turn === 1 ? [{ out: "Not In The Deck", in: "Night's Whisper", role: "draw", why: "x" }] : [{ out: cut, in: "Night's Whisper", role: "draw", why: "Cheap card draw" }];
      return { content: [{ type: "tool_use", id: `r${turn}`, name: "revise_deck", input: { swaps, notes: "One swap." } }], stop_reason: "tool_use" };
    };
    const out = await runAgent(
      { mode: "upgrade", seeds: names, commander: "Meren of Clan Nel Toth", basics: full.basics, budget: "any", bracket: 3 },
      { model: "m", callModel: caller, emit: () => {} },
    );
    assert.match(seen.prompt!, /UPGRADE A DECK[\s\S]*Commander: Meren of Clan Nel Toth[\s\S]*The deck:[\s\S]*Opening hands \(2000 goldfished games\)/);
    assert.ok(!seen.tools!.includes("submit_deck") && seen.tools!.includes("revise_deck") && seen.tools!.includes("search_cards"));
    assert.match(seen.results[0], /REJECTED[\s\S]*relative to the user's deck[\s\S]*"Not In The Deck" isn't in the deck/);
    assert.deepEqual(out!.swaps, [{ out: cut, in: "Night's Whisper", role: "draw", why: "Cheap card draw" }]);
    assert.ok(out!.deck.cards.some((c) => c.name === "Night's Whisper"));
    assert.ok(!out!.deck.cards.some((c) => c.name === cut));
    // the basics stay as the user split them (no rebalance in upgrade mode)
    for (const [b, q] of Object.entries(full.basics ?? {})) assert.equal(out!.deck.cards.find((c) => c.name === b)?.qty, q, b);
  } finally {
    fake.restore();
  }
});

test("upgrade my deck: a model that stops without swaps keeps the deck as it was", async () => {
  const fake = installFakeScryfall();
  try {
    const full = clone();
    let turn = 0;
    const caller: ModelCaller = async () => {
      turn++;
      return { content: [{ type: "text", text: "Looks great already." }], stop_reason: "end_turn" };
    };
    const out = await runAgent({ mode: "upgrade", seeds: full.cards.map((c) => c.name), commander: "Meren of Clan Nel Toth", basics: full.basics, budget: "any", bracket: 3 }, { model: "m", callModel: caller, emit: () => {} });
    assert.equal(turn, 2, "one nudge to call revise_deck");
    assert.deepEqual(out!.swaps, []);
    assert.equal(out!.deck.cards.reduce((n, c) => n + c.qty, 0) + 1, 100);
  } finally {
    fake.restore();
  }
});

// Engine variants: options parsing, the review pass, basics re-split, strict checks, combos.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelCaller } from "../lib/server/anthropic";
import { applySwaps, cleanAssistant, runAgent, toSubmission } from "../lib/server/agent";
import { checkCombos, comboErrors, parseCombos, resetComboCache } from "../lib/server/combos";
import { DEMO_SEEDS, DEMO_SUBMISSION } from "../lib/server/demo";
import { parseEngine } from "../lib/server/engine";
import { systemPrompt, toolsFor } from "../lib/server/prompt";
import { rebalanceBasics, strictProblems, type SubmittedDeck } from "../lib/server/validate";
import { analyzeDeck } from "../lib/shared/analysis";
import type { CardInfo, Deck, DeckCard, StreamEvent } from "../lib/shared/types";
import { installFakeScryfall, spellbook } from "./fixtures";

const clone = () => JSON.parse(JSON.stringify(DEMO_SUBMISSION)) as SubmittedDeck;

function card(name: string, typeLine: string, manaCost: string, text = "", extra: Partial<CardInfo> = {}): CardInfo {
  const cmc = (manaCost.match(/\{[^}]+\}/g) ?? []).reduce((n, s) => n + (/^\{\d+\}$/.test(s) ? Number(s.slice(1, -1)) : 1), 0);
  return {
    name, manaCost, cmc, typeLine, oracleText: text, colorIdentity: [], legalCommander: "legal", canBeCommander: false, gameChanger: false,
    priceEur: 1, priceUsd: 1, image: null, artCrop: null, artist: null, scryfallUri: "", edhrecRank: null, producedMana: [], ...extra,
  };
}
const dc = (info: CardInfo, role: DeckCard["role"] = "synergy", qty = 1): DeckCard => ({ name: info.name, qty, role, why: "", info });

test("parseEngine: presets, flags, effort, typos", () => {
  assert.equal(parseEngine().name, "v1");
  assert.equal(parseEngine("").prompt, 1);
  const v2 = parseEngine("v2");
  assert.deepEqual([v2.prompt, v2.fullText, v2.strict, v2.review, v2.manabase, v2.combos, v2.effort], [2, true, true, true, true, true, null]);
  assert.equal(parseEngine("v2-review").review, false);
  const mix = parseEngine("v1+strict+prompt2,effort=xhigh");
  assert.deepEqual([mix.prompt, mix.strict, mix.review, mix.effort], [2, true, false, "xhigh"]);
  assert.throws(() => parseEngine("v3"));
  assert.throws(() => parseEngine("v2+reveiw"));
  assert.throws(() => parseEngine("v2,effort=huge"));
});

test("v2 prompt plans first and offers revise_deck; v1 is unchanged", () => {
  const v1 = systemPrompt(parseEngine("v1"));
  const v2 = systemPrompt(parseEngine("v2"));
  assert.equal(systemPrompt(), v1);
  assert.ok(!v1.includes("PLAN BEFORE YOU SEARCH"));
  assert.match(v2, /PLAN BEFORE YOU SEARCH/);
  assert.match(v2, /revise_deck/);
  assert.match(v2, /re-splits them/);
  assert.deepEqual(toolsFor(parseEngine("v1")).map((t) => t.name), ["search_cards", "get_cards", "submit_deck"]);
  assert.deepEqual(toolsFor(parseEngine("v2")).map((t) => t.name), ["search_cards", "get_cards", "submit_deck", "revise_deck"]);
  assert.ok(!systemPrompt(parseEngine("v2-review")).includes("revise_deck"));
});

test("cleanAssistant keeps thinking blocks exactly, drops empty text and broken tool calls", () => {
  const blocks: any[] = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "redacted_thinking", data: "enc" },
    { type: "text", text: "  " },
    { type: "text", text: "Searching." },
    { type: "tool_use", id: "a", name: "search_cards", input: { __invalid_json: "{" } },
    { type: "tool_use", id: "b", name: "search_cards", input: { query: "x" } },
  ];
  assert.deepEqual(cleanAssistant(blocks).map((b: any) => b.type + (b.id ?? "")), ["thinking", "redacted_thinking", "text", "tool_useb"]);
});

test("applySwaps: cards and basics, seeds protected, unknown cards rejected", () => {
  const sub = clone();
  const ok = applySwaps(sub, [
    { out: "Phyrexian Arena", in: "Night's Whisper", role: "draw", why: "Cheap cards" },
    { out: "Forest", in: "Swamp" },
  ]);
  assert.deepEqual(ok.problems, []);
  assert.ok(ok.sub.cards.some((c) => c.name === "Night's Whisper"));
  assert.ok(!ok.sub.cards.some((c) => c.name === "Phyrexian Arena"));
  assert.equal(ok.sub.basics!.Forest, sub.basics!.Forest - 1);
  assert.equal(ok.sub.basics!.Swamp, sub.basics!.Swamp + 1);
  assert.equal(sub.cards.length, clone().cards.length, "the original is not mutated");
  const bad = applySwaps(sub, [{ out: "Viscera Seer", in: "Carrion Feeder" }, { out: "Not In Deck", in: "Sol Ring" }], ["Viscera Seer"]);
  assert.equal(bad.problems.length, 2);
  assert.equal(bad.sub, sub);
});

test("toSubmission round-trips a deck", () => {
  const deck: Deck = {
    name: "N", commander: dc(card("Meren of Clan Nel Toth", "Legendary Creature", "{2}{B}{G}"), "wincon"), strategy: "s", winConditions: ["w"], bracketNotes: "b", colorIdentity: ["B", "G"],
    cards: [dc(card("Sol Ring", "Artifact", "{1}"), "ramp"), dc(card("Forest", "Basic Land — Forest", ""), "land", 9)],
  };
  const s = toSubmission(deck);
  assert.deepEqual(s.basics, { Forest: 9 });
  assert.deepEqual(s.cards, [{ name: "Sol Ring", role: "ramp", why: "" }]);
  assert.equal(s.commander, "Meren of Clan Nel Toth");
});

test("rebalanceBasics moves basics to the color that needs sources, keeping the total", () => {
  const gg = Array.from({ length: 8 }, (_, i) => dc(card(`Green ${i}`, "Creature", "{1}{G}{G}")));
  const b = Array.from({ length: 4 }, (_, i) => dc(card(`Black ${i}`, "Creature", "{3}{B}")));
  const dual = card("Overgrown Tomb", "Land — Swamp Forest", "", "", { producedMana: ["B", "G"] });
  const deck: Deck = {
    name: "t", commander: dc(card("Meren of Clan Nel Toth", "Legendary Creature", "{2}{B}{G}"), "wincon"), strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"],
    cards: [...gg, ...b, dc(dual, "land"), dc(card("Swamp", "Basic Land — Swamp", ""), "land", 20)],
  };
  const note = rebalanceBasics(deck);
  assert.ok(note);
  const forest = deck.cards.find((c) => c.name === "Forest")?.qty ?? 0;
  const swamp = deck.cards.find((c) => c.name === "Swamp")?.qty ?? 0;
  assert.equal(forest + swamp, 20);
  assert.ok(forest > swamp, `${forest} Forest vs ${swamp} Swamp`);
  assert.ok(swamp >= 6, "black still gets sources");
  assert.equal(rebalanceBasics(deck), null, "a balanced split is left alone");
});

test("strictProblems flags real gaps with what was counted", () => {
  const deck: Deck = {
    name: "t", commander: dc(card("C", "Legendary Creature", "{G}")), strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["G"],
    cards: [dc(card("Sol Ring", "Artifact", "{1}", "{T}: Add {C}{C}."), "ramp"), dc(card("Bear", "Creature", "{1}{G}"), "ramp"), dc(card("Forest", "Basic Land — Forest", "", "", { producedMana: ["G"] }), "land", 30)],
  };
  const p = strictProblems(analyzeDeck(deck));
  assert.ok(p.some((m) => /Only 30 lands/.test(m)));
  assert.ok(p.some((m) => /only 1 ramp card\(s\) \(Sol Ring\)/.test(m)));
  assert.ok(p.some((m) => /card draw/.test(m)));
  assert.ok(p.some((m) => /targeted removal/.test(m)));
  assert.ok(!p.some((m) => /make or fetch G/.test(m)), "30 Forests are enough sources");
});

const SB = (cards: string[], tag: string) => ({ id: `${cards.length}-${tag}`, uses: cards.map((name) => ({ card: { name } })), produces: [{ feature: { name: "Infinite colorless mana" } }], bracketTag: tag });

test("combos: parse Commander Spellbook results; only two-card high-bracket combos are errors", async () => {
  const body = { results: { included: [SB(["Sol Ring", "Ashnod's Altar"], "R"), SB(["Viscera Seer", "Grim Haruspex", "Eternal Witness"], "R"), SB(["Phyrexian Arena", "Harmonize"], "P")] } };
  const combos = parseCombos(body);
  assert.deepEqual(combos[0].cards, ["Sol Ring", "Ashnod's Altar"]);
  assert.equal(combos[0].bracketTag, "R");
  assert.match(combos[0].url, /commanderspellbook\.com\/combo\//);
  const deck: Deck = { name: "t", commander: dc(card("Meren", "Legendary Creature", "{B}")), strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B"], cards: [] };
  const r = await checkCombos(deck, (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch);
  assert.ok(r.checked);
  assert.equal(r.tooStrong.length, 1);
  assert.match(comboErrors(r)[0], /Sol Ring \+ Ashnod's Altar .*Ruthless/);
  const down = await checkCombos({ ...deck, name: "other", cards: [dc(card("X", "Artifact", "{1}"))] }, (async () => new Response("", { status: 503 })) as typeof fetch);
  assert.equal(down.checked, false);
});

test("v2 agent: legal deck gets one review round; revise_deck swaps are checked and applied", async () => {
  const fake = installFakeScryfall();
  spellbook.body = { results: { included: [] } };
  try {
    const seen: string[] = [];
    let turn = 0;
    const caller: ModelCaller = async (params) => {
      turn++;
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const r of last.content) if (r.type === "tool_result") seen.push(String(r.content));
      assert.deepEqual(params.tools?.map((t: any) => t.name), ["search_cards", "get_cards", "submit_deck", "revise_deck"]);
      if (turn === 1) return { content: [{ type: "tool_use", id: "s1", name: "submit_deck", input: clone() }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 50 } };
      if (turn === 2) return { content: [{ type: "tool_use", id: "r1", name: "revise_deck", input: { swaps: [{ out: "Viscera Seer", in: "Carrion Feeder", role: "synergy", why: "x" }, { out: "Nope", in: "Sol Ring", role: "ramp", why: "x" }] } }], stop_reason: "tool_use", usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 20 } };
      return { content: [{ type: "tool_use", id: "r2", name: "revise_deck", input: { swaps: [{ out: "Phyrexian Arena", in: "Night's Whisper", role: "draw", why: "Cheaper draw" }], notes: "Cheaper draw." } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 20 } };
    };
    const events: StreamEvent[] = [];
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any" }, { model: "m", callModel: caller, emit: (e) => events.push(e), engine: parseEngine("v2-strict") });
    assert.ok(out?.validation.ok);
    assert.match(seen[0], /ACCEPTED — the deck is legal[\s\S]*Counted from Oracle text[\s\S]*revise_deck/);
    assert.match(seen[1], /REJECTED[\s\S]*seed card[\s\S]*Nope/);
    const names = out!.deck.cards.map((c) => c.name);
    assert.ok(names.includes("Night's Whisper") && !names.includes("Phyrexian Arena"));
    assert.ok(names.includes("Viscera Seer"), "seeds stay");
    assert.equal(out!.review, "Cheaper draw.");
    assert.ok(out!.analysis.lands > 30);
    const usage = events.filter((e) => e.type === "usage").at(-1) as Extract<StreamEvent, { type: "usage" }>;
    assert.deepEqual(usage.usage, { calls: 3, input: 120, cacheRead: 90, cacheWrite: 0, output: 90 });
  } finally {
    fake.restore();
  }
});

test("v2 agent: a high-bracket two-card combo is rejected, unless it's made of the user's own picks", async () => {
  const fake = installFakeScryfall();
  resetComboCache();
  spellbook.body = (req: any) => {
    const names = req.main.map((m: any) => m.card);
    const included = [];
    if (names.includes("Ashnod's Altar")) included.push(SB(["Sol Ring", "Ashnod's Altar"], "R"));
    included.push(SB(["Viscera Seer", "Grim Haruspex"], "R")); // both seeds
    included.push(SB(["Phyrexian Arena", "Harmonize"], "S")); // slower: flagged only
    return { results: { included } };
  };
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
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any" }, { model: "m", callModel: caller, emit: () => {}, engine: parseEngine("v2-strict-review") });
    assert.match(seen[0], /REJECTED[\s\S]*Sol Ring \+ Ashnod's Altar[\s\S]*too strong for Bracket 3/);
    assert.ok(out?.validation.ok);
    assert.ok(out!.validation.warnings.some((w) => /Viscera Seer \+ Grim Haruspex .*your own picks/.test(w)));
    assert.ok(out!.validation.warnings.some((w) => /Phyrexian Arena \+ Harmonize .*Spicy/.test(w)));
  } finally {
    spellbook.body = { results: { included: [] } };
    fake.restore();
  }
});

test("effort is sent only when the engine sets it", async () => {
  const fake = installFakeScryfall();
  try {
    const seen: any[] = [];
    const caller: ModelCaller = async (params) => {
      seen.push(params);
      return { content: [{ type: "tool_use", id: "s", name: "submit_deck", input: clone() }], stop_reason: "tool_use" };
    };
    await runAgent({ seeds: DEMO_SEEDS, commander: null, budget: "any" }, { model: "m", callModel: caller, emit: () => {}, engine: parseEngine("v1,effort=xhigh") });
    await runAgent({ seeds: DEMO_SEEDS, commander: null, budget: "any" }, { model: "m", callModel: caller, emit: () => {} });
    assert.deepEqual(seen[0].output_config, { effort: "xhigh" });
    assert.equal(seen[1].output_config, undefined);
    assert.equal(seen[1].max_tokens, 16000);
  } finally {
    fake.restore();
  }
});

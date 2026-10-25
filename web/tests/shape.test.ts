// Deck shape: the user's limits are parsed safely, counted from card text, and enforced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkShape, cleanShape, shapeProblems, shapeText } from "../lib/shared/shape";
import { parseRequest } from "../lib/server/generate-handler";
import { runAgent } from "../lib/server/agent";
import { DEMO_SEEDS, DEMO_SUBMISSION } from "../lib/server/demo";
import { installFakeScryfall } from "./fixtures";
import type { ModelCaller } from "../lib/server/anthropic";

test("cleanShape: numbers only, min ≤ max, sensible limits", () => {
  assert.equal(cleanShape(undefined), undefined);
  assert.equal(cleanShape({ creatures: { min: "", max: "" } }), undefined);
  assert.deepEqual(cleanShape({ creatures: { min: "25", max: 30 }, lands: { max: "37" }, maxAvgMv: "3.15", junk: { min: 1 } }), { creatures: { min: 25, max: 30 }, lands: { max: 37 }, maxAvgMv: 3.2 });
  assert.match(String(cleanShape({ ramp: { min: 12, max: 8 } })), /Ramp: the minimum \(12\) is above the maximum \(8\)/);
  assert.match(String(cleanShape({ lands: { min: 60 }, creatures: { min: 45 } })), /can't be more than the 99/);
  assert.match(String(cleanShape({ lands: { max: 10 } })), /Fewer than 25 lands/);
  assert.match(String(cleanShape({ maxAvgMv: 9 })), /between 1.5 and 6/);
  assert.deepEqual(cleanShape({ draw: { min: -3, max: 500 } }), undefined, "out-of-range numbers are ignored");
});

test("shape checks and messages", () => {
  const counts = { creatures: 22, lands: 38, ramp: 10, draw: 9, removal: 8, wipes: 1, avgMv: 3.41 };
  const shape = { creatures: { min: 28 }, lands: { min: 35, max: 37 }, wipes: { min: 1, max: 3 }, maxAvgMv: 3.2 };
  assert.deepEqual(checkShape(shape, counts).map((c) => [c.key, c.ok]), [["creatures", false], ["lands", false], ["wipes", true], ["avgMv", false]]);
  const p = shapeProblems(shape, counts);
  assert.match(p[0], /Creatures: the deck has 22; the user wants at least 28\. Add 6/);
  assert.match(p[1], /Lands: the deck has 38; the user wants 35–37\. Cut 1/);
  assert.match(p[2], /average mana value is 3.41/);
  assert.match(shapeText(shape), /DECK SHAPE[\s\S]*creatures at least 28; lands 35–37; board wipes 1–3; average mana value of the nonland cards at most 3.2/);
});

test("parseRequest keeps a shape and rejects a broken one", () => {
  const base = { seeds: ["a", "b", "c", "d", "e"], commander: null, budget: "any" };
  const r = parseRequest({ ...base, shape: { creatures: { min: 30 } } });
  assert.ok(typeof r !== "string" && r.shape?.creatures?.min === 30);
  assert.match(String(parseRequest({ ...base, shape: { lands: { min: 40, max: 30 } } })), /minimum \(40\) is above the maximum \(30\)/);
});

test("a build that misses a limit goes back to Claude; the deck records the shape", async () => {
  const fake = installFakeScryfall();
  try {
    const results: string[] = [];
    let prompt = "";
    const caller: ModelCaller = async (params) => {
      if (!prompt) prompt = typeof params.messages[0].content === "string" ? params.messages[0].content : "";
      const last = params.messages.at(-1);
      if (Array.isArray(last.content)) for (const x of last.content) if (x.type === "tool_result") results.push(String(x.content));
      return { content: [{ type: "tool_use", id: `s${results.length}`, name: "submit_deck", input: DEMO_SUBMISSION }], stop_reason: "tool_use" };
    };
    const out = await runAgent({ seeds: DEMO_SEEDS, commander: "Meren of Clan Nel Toth", budget: "any", bracket: 3, shape: { creatures: { max: 5 } } }, { model: "m", callModel: caller, emit: () => {} });
    assert.match(prompt, /DECK SHAPE[\s\S]*creatures at most 5/);
    assert.match(results[0], /REJECTED[\s\S]*Creatures: the deck has \d+; the user wants at most 5\. Cut/);
    assert.deepEqual(out!.deck.shape, { creatures: { max: 5 } });
    // after three tries it's a warning, not a failed build
    assert.ok(out!.validation.warnings.some((w) => /Creatures: the deck has \d+; the user wants at most 5/.test(w)), out!.validation.warnings.join(" | "));
  } finally {
    fake.restore();
  }
});

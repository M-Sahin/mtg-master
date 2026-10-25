// Eval harness: build every seed hand with each engine variant, score the decks, judge them
// blind in pairs, and write a report. Run through scripts/eval.mjs:
//
//   node scripts/eval.mjs check                       # hands resolve on Scryfall + combo service probe (no API key)
//   ANTHROPIC_API_KEY=… node scripts/eval.mjs run --variants v1,v2 --hands 6 --judge claude-opus-5-5
//
// Options: --variants (comma list of engine specs, the first is the baseline), --hands (all, a
// number, or comma-separated ids), --model, --judge (a model, or "none"), --repeat, --concurrency, --out,
// --max-usd (stop starting builds and judging once the estimated spend reaches this; default 4).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicCaller, type ModelCaller } from "../lib/server/anthropic";
import { costUsd as priceOf } from "../lib/shared/models";
import { resolveSeeds, runAgent, type AgentResult } from "../lib/server/agent";
import { checkCombos, parseCombos } from "../lib/server/combos";
import { parseEngine } from "../lib/server/engine";
import { analysisReport } from "../lib/shared/analysis";
import { exportText } from "../lib/shared/deck-utils";
import type { Deck, StreamEvent } from "../lib/shared/types";
import { judgePair, type PairResult } from "./judge";
import { renderReport } from "./report";
import { aggregate, scoreBuild, type Hand, type Score } from "./score";

const here = process.env.EVAL_DIR ?? join(process.cwd(), "evals");

function args(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1");
    } else out._ = out._ ? `${out._} ${a}` : a;
  }
  return out;
}

function loadHands(sel = "all"): Hand[] {
  const all = JSON.parse(readFileSync(join(here, "hands.json"), "utf8")) as Hand[];
  if (sel === "all") return all;
  if (/^\d+$/.test(sel)) return all.slice(0, Number(sel));
  const ids = new Set(sel.split(",").map((s) => s.trim()));
  const picked = all.filter((h) => ids.has(h.id));
  if (picked.length !== ids.size) throw new Error(`Unknown hand id in "${sel}"`);
  return picked;
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

async function check() {
  const hands = loadHands();
  let bad = 0;
  for (const h of hands) {
    const { seeds, problems } = await resolveSeeds(h.seeds);
    const cmd = h.commander ? seeds.find((s) => s.name.toLowerCase().split(" // ")[0] === h.commander!.toLowerCase().split(" // ")[0]) : null;
    const issues = [...problems];
    if (h.commander && !cmd?.canBeCommander) issues.push(`${h.commander} can't be the commander`);
    if (new Set(h.seeds.map((s) => s.toLowerCase())).size !== 5 || h.seeds.length !== 5) issues.push("needs five different seeds");
    const gc = seeds.filter((s) => s.gameChanger).map((s) => s.name);
    console.log(`${issues.length ? "FAIL" : "ok  "} ${h.id.padEnd(24)} ${seeds.map((s) => `${s.name} [${s.colorIdentity.join("") || "C"}]`).join(", ")}${gc.length ? `  (Game Changers: ${gc.join(", ")})` : ""}${issues.length ? `\n     ${issues.join("; ")}` : ""}`);
    if (issues.length) bad++;
  }
  // Commander Spellbook: confirm the endpoint and response shape with a known combo
  const probe = {
    name: "probe", strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["U", "B"],
    commander: { name: "Tasigur, the Golden Fang", qty: 1, role: "wincon", why: "" },
    cards: ["Thassa's Oracle", "Demonic Consultation", "Exquisite Blood", "Sanguine Bond", "Sol Ring"].map((name) => ({ name, qty: 1, role: "synergy", why: "" })),
  } as unknown as Deck;
  const raw = await fetch("https://backend.commanderspellbook.com/find-my-combos", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ commanders: [{ card: probe.commander.name }], main: probe.cards.map((c) => ({ card: c.name, quantity: 1 })) }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch((e) => ({ status: 0, body: String(e) }));
  console.log(`\nCommander Spellbook find-my-combos: HTTP ${raw.status}`);
  const first = raw.body?.results?.included?.[0];
  console.log(`response keys: ${raw.body && typeof raw.body === "object" ? Object.keys(raw.body).join(", ") : String(raw.body).slice(0, 200)}`);
  if (raw.body?.results) console.log(`results keys: ${Object.keys(raw.body.results).join(", ")}`);
  if (first) console.log(`first variant keys: ${Object.keys(first).join(", ")}\nfirst variant (trimmed): ${JSON.stringify(first).slice(0, 1500)}`);
  const parsed = parseCombos(raw.body);
  for (const c of parsed) console.log(`  combo: ${c.cards.join(" + ")} -> ${c.results.slice(0, 2).join(", ")} [${c.bracketTag}]`);
  const report = await checkCombos(probe);
  console.log(`checkCombos: checked=${report.checked} combos=${report.combos.length} tooStrong=${report.tooStrong.map((c) => c.cards.join("+")).join("; ") || "none"}${report.error ? ` error=${report.error}` : ""}`);
  // a third-party outage shouldn't block evals: the build reports "combo check unavailable" instead
  if (!report.checked || !report.combos.length) console.warn("WARNING: combo probe failed; builds will run without the combo check");
  if (bad) {
    console.error(`${bad} problem(s)`);
    process.exit(1);
  }
}

interface Build {
  hand: Hand;
  variant: string;
  run: number;
  score: Score;
  deck?: Deck;
  result?: AgentResult | null;
}

async function run(o: Record<string, string>) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("Set ANTHROPIC_API_KEY to run evals (use a key with a spend limit).");
  const variants = (o.variants ?? "v1,v2").split(",").map((s) => s.trim()).filter(Boolean);
  const engines = variants.map((v) => parseEngine(v)); // fail fast on typos
  const hands = loadHands(o.hands ?? "all");
  const model = o.model ?? "claude-sonnet-5-5";
  const judge = o.judge ?? "claude-opus-5-5";
  const repeat = Math.max(1, Number(o.repeat ?? 1));
  const concurrency = Math.max(1, Number(o.concurrency ?? 3));
  const maxUsd = Math.max(0.1, Number(o["max-usd"] ?? 4));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = o.out ?? join(here, "out", stamp);
  mkdirSync(join(out, "decks"), { recursive: true });
  // every model call is priced as it happens; past the budget nothing new starts, and a call
  // that would run far past it (1.3× the budget) is refused, so a small credit balance is safe
  let spent = 0;
  const raw = anthropicCaller(key);
  const caller: ModelCaller = async (params, handlers, signal) => {
    if (spent >= maxUsd * 1.3) throw new Error(`eval budget of $${maxUsd} used up`);
    const msg = await raw(params, handlers, signal);
    const u = msg.usage ?? {};
    spent += priceOf(params.model, { calls: 1, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }) ?? 0;
    return msg;
  };

  const jobs = hands.flatMap((hand) => engines.flatMap((engine, vi) => Array.from({ length: repeat }, (_, r) => ({ hand, engine, variant: variants[vi], run: r + 1 }))));
  console.log(`Eval: ${hands.length} hands × ${variants.length} variants × ${repeat} = ${jobs.length} builds with ${model}; judge ${judge}; output ${out}`);
  const builds: Build[] = [];
  await pool(jobs, concurrency, async (j, i) => {
    if (spent >= maxUsd) {
      console.log(`[${i + 1}/${jobs.length}] ${j.hand.id} ${j.variant}#${j.run}: skipped (estimated spend $${spent.toFixed(2)} reached the $${maxUsd} budget)`);
      return;
    }
    const events: StreamEvent[] = [];
    const started = Date.now();
    let result: AgentResult | null = null;
    let error: string | undefined;
    try {
      result = await runAgent({ seeds: j.hand.seeds, commander: j.hand.commander, budget: j.hand.budget, theme: j.hand.theme }, { model, callModel: caller, emit: (e) => events.push(e), engine: j.engine });
    } catch (e) {
      error = (e as Error).message;
    }
    const ms = Date.now() - started;
    const combos = result ? await checkCombos(result.deck) : null; // scored for every variant
    const score = scoreBuild({ hand: j.hand, variant: j.variant, run: j.run, model, ms, events, result, combos, error });
    builds.push({ hand: j.hand, variant: j.variant, run: j.run, score, deck: result?.deck, result });
    const file = `${j.hand.id}--${j.variant.replace(/[^\w.-]+/g, "_")}--${j.run}.txt`;
    if (result) {
      writeFileSync(
        join(out, "decks", file),
        [`# ${result.deck.name} (${j.variant}, run ${j.run})`, `Seeds: ${j.hand.seeds.join("; ")}`, "", result.deck.strategy, "", exportText(result.deck), "", analysisReport(result.analysis), result.review ? `\n${result.review}` : "", "", `Warnings: ${result.validation.warnings.join(" ") || "none"}`].join("\n"),
      );
    }
    console.log(`[${i + 1}/${jobs.length}] ${j.hand.id} ${j.variant}#${j.run}: ${score.ok ? "ok" : `FAILED (${score.error})`} in ${Math.round(ms / 1000)}s, ${score.searches} searches, ${score.submits} submits, $${score.costUsd?.toFixed(3) ?? "?"}, template ${score.templateHits}/6, staples ${Math.round(score.stapleShare * 100)}%`);
  });

  // blind pairwise judging: every variant against the baseline (first) on the same hand and run
  const pairs: PairResult[] = [];
  if (judge !== "none" && variants.length > 1) {
    const tasks: { hand: Hand; a: Build; b: Build }[] = [];
    for (const hand of hands)
      for (let r = 1; r <= repeat; r++) {
        const base = builds.find((b) => b.hand.id === hand.id && b.variant === variants[0] && b.run === r && b.deck);
        for (const v of variants.slice(1)) {
          const other = builds.find((b) => b.hand.id === hand.id && b.variant === v && b.run === r && b.deck);
          if (base && other) tasks.push({ hand, a: base, b: other });
        }
      }
    console.log(`Judging ${tasks.length} pair(s) with ${judge}`);
    await pool(tasks, concurrency, async (t) => {
      if (spent >= maxUsd) {
        console.log(`  ${t.hand.id}: not judged (budget reached)`);
        return;
      }
      try {
        const p = await judgePair(caller, judge, t.hand, { variant: t.a.variant, deck: t.a.deck! }, { variant: t.b.variant, deck: t.b.deck! });
        pairs.push(p);
        console.log(`  ${t.hand.id}: ${t.a.variant} vs ${t.b.variant} → ${p.winner}${p.agree ? "" : " (orders disagreed)"}`);
      } catch (e) {
        console.log(`  ${t.hand.id}: judge failed: ${(e as Error).message}`);
      }
    });
  }

  const scores = builds.map((b) => b.score);
  const aggregates = variants.map((v) => {
    const a = aggregate(v, scores);
    if (v !== variants[0]) {
      const mine = pairs.filter((p) => p.b === v);
      a.judgeWins = mine.filter((p) => p.winner === v).length;
      a.judgeLosses = mine.filter((p) => p.winner === p.a).length;
      a.judgeTies = mine.filter((p) => p.winner === "tie").length;
    }
    return a;
  });
  console.log(`Estimated spend: $${spent.toFixed(2)} of the $${maxUsd} budget`);
  const meta = { model, judge, variants, hands: hands.map((h) => h.id), repeat, date: new Date().toISOString(), spentUsd: Math.round(spent * 100) / 100 };
  writeFileSync(join(out, "results.json"), JSON.stringify({ meta, aggregates, scores, pairs }, null, 2));
  const md = renderReport({ meta, aggregates, scores, pairs });
  writeFileSync(join(out, "report.md"), md);
  console.log(`\n${md}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
}

const o = args(process.argv.slice(2));
const mode = (o._ ?? "").trim() || "run";
(mode === "check" ? check() : mode === "run" ? run(o) : Promise.reject(new Error(`Unknown mode "${mode}" (check or run)`))).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

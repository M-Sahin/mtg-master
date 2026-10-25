// The deckbuilding agent: Claude + the mtg-master skill + Scryfall tools + server-side validation.
// Engine variants (lib/server/engine.ts) switch the quality improvements on and off.
import type { ModelCaller, ContentBlock } from "./anthropic";
import { checkCombos, comboErrors, comboNotes, type ComboReport } from "./combos";
import { DraftScanner } from "./draft-scanner";
import { parseEngine, type EngineOptions } from "./engine";
import { systemPrompt, toolsFor, userPrompt } from "./prompt";
import * as scry from "./scryfall";
import { buildDeck, namesInSubmission, rebalanceBasics, repairCount, strictProblems, validateDeck, type SubmittedDeck } from "./validate";
import { analysisReport, analyzeDeck, type DeckAnalysis } from "../shared/analysis";
import type { CardInfo, Deck, GenerateRequest, Role, StreamEvent, Usage, Validation } from "../shared/types";
import { ROLES, isBasicLand } from "../shared/types";

export interface AgentOptions {
  model: string;
  callModel: ModelCaller;
  emit: (e: StreamEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  timeBudgetMs?: number; // soft deadline: after this Claude is told to submit
  hardDeadlineMs?: number; // stop and return the best deck so far
  engine?: EngineOptions;
}

export interface AgentResult {
  deck: Deck;
  validation: Validation;
  analysis: DeckAnalysis;
  combos?: ComboReport;
  /** What the review pass changed, if it ran. */
  review?: string;
}

const MAX_SUBMITS = 4;
const MAX_REVISES = 2;
const REVIEW_NEEDS_MS = 75_000; // time left needed to start a review round

function excerpt(t: string, n = 140) {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function cardLine(c: CardInfo, text: "none" | "excerpt" | "full" = "excerpt") {
  const bits = [
    c.name,
    c.manaCost || "—",
    c.typeLine,
    `id:${c.colorIdentity.join("") || "C"}`,
    c.priceEur != null ? `€${c.priceEur.toFixed(2)}` : c.priceUsd != null ? `$${c.priceUsd.toFixed(2)}` : "no price",
  ];
  if (c.gameChanger) bits.push("GAME CHANGER");
  if (c.legalCommander !== "legal") bits.push(`commander:${c.legalCommander}`);
  if (text === "none" || !c.oracleText) return bits.join(" | ");
  return bits.join(" | ") + ` :: ${text === "full" ? excerpt(c.oracleText, 700) : excerpt(c.oracleText)}`;
}

function toolLabel(name: string, input: any): string {
  if (name === "search_cards") return String(input?.query ?? "");
  if (name === "get_cards") {
    const n: string[] = input?.names ?? [];
    return n.length <= 3 ? n.join(", ") : `${n.slice(0, 3).join(", ")} +${n.length - 3}`;
  }
  if (name === "submit_deck") return "Validating the full deck";
  if (name === "revise_deck") return `${(input?.swaps ?? []).length} swap(s)`;
  return name;
}

export async function resolveSeeds(names: string[]): Promise<{ seeds: CardInfo[]; problems: string[] }> {
  const { found, notFound } = await scry.getCollection(names);
  const problems: string[] = notFound.map((n) => `"${n}" isn't a card Scryfall knows.`);
  const seeds: CardInfo[] = [];
  for (const n of names) {
    const c = found.get(n.toLowerCase());
    if (!c) continue;
    if (c.legalCommander === "banned") problems.push(`${c.name} is banned in Commander.`);
    else if (c.legalCommander === "not_legal") problems.push(`${c.name} isn't legal in Commander.`);
    seeds.push(c);
  }
  return { seeds, problems };
}

const MAX_PARALLEL_TOOLS = 6;

/** Copy of the history with one moving cache breakpoint on the newest user block. */
function withCacheBreakpoint(messages: any[]): any[] {
  const out = messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? m.content.map((b: any) => ({ ...b })) : m.content }));
  const last = out[out.length - 1];
  if (last?.role === "user") {
    if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
    const blocks = last.content as any[];
    if (blocks.length) blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  }
  return out;
}

/**
 * Blocks to send back. Thinking and redacted_thinking blocks go back exactly as received
 * (the API rejects a rebuilt message); empty text and tool calls with broken JSON are dropped.
 */
export function cleanAssistant(content: ContentBlock[]): ContentBlock[] {
  return content.filter((b: any) =>
    b.type === "text" ? b.text?.trim() : b.type === "tool_use" ? !b.input?.__invalid_json : b.type === "thinking" ? !!b.signature : b.type === "redacted_thinking",
  );
}

export function emptyUsage(): Usage {
  return { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

/** The accepted deck as a submission again, so the review pass can swap cards in it. */
export function toSubmission(deck: Deck): SubmittedDeck {
  return {
    deck_name: deck.name,
    commander: deck.commander.name,
    partner: deck.partner?.name,
    strategy: deck.strategy,
    win_conditions: deck.winConditions,
    bracket_notes: deck.bracketNotes,
    cards: deck.cards.filter((c) => !isBasicLand(c.name)).map((c) => ({ name: c.name, role: c.role, why: c.why })),
    basics: Object.fromEntries(deck.cards.filter((c) => isBasicLand(c.name)).map((c) => [c.name, c.qty])),
  };
}

export interface Swap {
  out: string;
  in: string;
  role?: string;
  why?: string;
}

/** Apply swaps to a submission. Returns the problems (unknown "out" cards etc.); applies nothing if any. */
export function applySwaps(sub: SubmittedDeck, swaps: Swap[], protect: string[] = []): { sub: SubmittedDeck; problems: string[] } {
  const next: SubmittedDeck = { ...sub, cards: sub.cards.map((c) => ({ ...c })), basics: { ...(sub.basics ?? {}) } };
  const problems: string[] = [];
  const keep = new Set(protect.map((p) => p.toLowerCase()));
  for (const s of swaps) {
    const out = String(s.out ?? "").trim();
    const inn = String(s.in ?? "").trim();
    if (!out || !inn) {
      problems.push("Each swap needs an \"out\" and an \"in\" card.");
      continue;
    }
    if (keep.has(out.toLowerCase())) {
      problems.push(`${out} is a seed card or the commander and has to stay.`);
      continue;
    }
    const basicKey = Object.keys(next.basics!).find((k) => k.toLowerCase() === out.toLowerCase());
    const idx = next.cards.findIndex((c) => c.name.toLowerCase() === out.toLowerCase());
    if (isBasicLand(out) && basicKey && next.basics![basicKey] > 0) next.basics![basicKey]--;
    else if (idx >= 0) next.cards.splice(idx, 1);
    else {
      problems.push(`"${out}" isn't in the deck (use the exact name from your list).`);
      continue;
    }
    if (isBasicLand(inn)) {
      const k = Object.keys(next.basics!).find((x) => x.toLowerCase() === inn.toLowerCase()) ?? inn;
      next.basics![k] = (next.basics![k] ?? 0) + 1;
    } else next.cards.push({ name: inn, role: s.role ?? "utility", why: s.why ?? "" });
  }
  return { sub: problems.length ? sub : next, problems };
}

interface Checked {
  deck: Deck;
  validation: Validation;
  analysis: DeckAnalysis;
  combos?: ComboReport;
}

/** Look up, build, (re)balance and validate a submission with every check the engine enables. */
async function checkSubmission(sub: SubmittedDeck, attempt: number, req: GenerateRequest, seedNames: string[], engine: EngineOptions): Promise<Checked> {
  const { found, notFound } = await scry.getCollection(namesInSubmission(sub));
  const deck = buildDeck(sub, found, seedNames);
  const notes: string[] = [];
  const fillInfo = async () => {
    const missing = deck.cards.filter((c) => !c.info).map((c) => c.name);
    if (!missing.length) return;
    const extra = await scry.getCollection(missing);
    for (const c of deck.cards) if (!c.info) c.info = extra.found.get(c.name.toLowerCase());
  };
  if (engine.manabase) {
    const note = rebalanceBasics(deck);
    if (note) {
      notes.push(note);
      await fillInfo();
    }
  }
  const opts = { commander: req.commander };
  let validation = validateDeck(deck, notFound, seedNames, opts);
  // After a couple of tries, fix pure count problems ourselves.
  if (!validation.ok && attempt >= 2 && validation.errors.every((e) => e.startsWith("Deck has "))) {
    const note = repairCount(deck);
    if (note) {
      await fillInfo();
      notes.push(note);
      validation = validateDeck(deck, notFound, seedNames, opts);
    }
  }
  const analysis = analyzeDeck(deck, { budget: req.budget, seeds: seedNames });
  // The stricter checks only block the first attempts, so a heuristic miss can't sink a build.
  if (engine.strict && attempt <= 2) validation.errors.push(...strictProblems(analysis));
  let combos: ComboReport | undefined;
  if (engine.combos && validation.errors.every((e) => !e.startsWith("Deck has "))) {
    combos = await checkCombos(deck);
    const chosen = new Set([...seedNames, deck.commander.name, deck.partner?.name ?? ""].map((n) => n.toLowerCase()));
    // a combo made only of the user's own picks is their call: warn, don't reject
    const forced = combos.tooStrong.filter((c) => c.cards.every((n) => chosen.has(n.toLowerCase())));
    const blocking = { ...combos, tooStrong: combos.tooStrong.filter((c) => !forced.includes(c)) };
    if (attempt <= 3) validation.errors.push(...comboErrors(blocking));
    else validation.warnings.push(...comboErrors(blocking));
    for (const c of forced) validation.warnings.push(`${c.cards.join(" + ")} is a strong two-card combo made of your own picks; Bracket 3 tables may not expect it.`);
    for (const c of combos.flagged ?? []) validation.warnings.push(`Combo in the deck: ${c.cards.join(" + ")} (${c.results.slice(0, 2).join(", ")}), rated Spicy by Commander Spellbook. Fine for Bracket 3, but mention it at the table.`);
    if (!combos.checked) validation.warnings.push(combos.error ?? "Combo check unavailable.");
  }
  validation.ok = validation.errors.length === 0;
  validation.warnings.unshift(...notes);
  return { deck, validation, analysis, combos };
}

export async function runAgent(req: GenerateRequest, opts: AgentOptions): Promise<AgentResult | null> {
  const { emit } = opts;
  const engine = opts.engine ?? parseEngine();
  const started = Date.now();
  const soft = opts.timeBudgetMs ?? 200_000; // after this, Claude is told to submit now
  const hard = opts.hardDeadlineMs ?? 268_000; // before Vercel's 300 s limit, with room to send the result
  const maxTurns = opts.maxTurns ?? (engine.review ? 16 : 14);
  const left = () => hard - (Date.now() - started);
  const usage = emptyUsage();

  emit({ type: "status", text: "Reading your five seed cards" });
  const { seeds, problems } = await resolveSeeds(req.seeds);
  if (problems.length) {
    emit({ type: "error", message: problems.join(" ") });
    return null;
  }
  if (req.commander) {
    const c = seeds.find((s) => s.name.toLowerCase() === req.commander!.toLowerCase());
    if (!c?.canBeCommander) {
      emit({ type: "error", message: `${req.commander} can't be a commander.` });
      return null;
    }
    req = { ...req, commander: c.name };
  }
  const seedNames = seeds.map((s) => s.name);

  const system = [{ type: "text", text: systemPrompt(engine), cache_control: { type: "ephemeral" } }];
  const tools = toolsFor(engine);
  const messages: any[] = [{ role: "user", content: userPrompt(req, seeds) }];
  const baseTokens = engine.prompt === 2 ? 32000 : 16000;
  let submits = 0;
  let revises = 0;
  let nudged = false;
  let truncated = 0;
  let reviewing = false; // a legal deck is waiting for its review swaps
  let reviewNote: string | undefined;
  let lastDeck: AgentResult | null = null;

  emit({ type: "status", text: "Claude is studying the seeds with the mtg-master skill" });

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) return lastDeck;
    if (left() < 15_000) break;
    const scanner = new DraftScanner();
    const timeout = AbortSignal.timeout(Math.max(1000, left()));
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let msg;
    try {
      msg = await opts.callModel(
        {
          model: opts.model,
          max_tokens: truncated ? baseTokens * 2 : baseTokens,
          system,
          messages: withCacheBreakpoint(messages),
          tools,
          ...(engine.effort ? { output_config: { effort: engine.effort } } : {}),
        },
        {
          onText: (d) => emit({ type: "text", delta: d }),
          onToolStart: (_i, _id, name) => {
            if (name === "submit_deck") emit({ type: "draft_start", attempt: submits + 1 });
          },
          onToolInput: (_i, name, acc) => {
            if (name !== "submit_deck") return;
            const hadMeta = { ...scanner.meta };
            for (const c of scanner.feed(acc)) {
              emit({ type: "draft_card", name: c.name, role: ((ROLES as readonly string[]).includes(c.role) ? c.role : "utility") as Role });
            }
            if (scanner.meta.commander !== hadMeta.commander || scanner.meta.deckName !== hadMeta.deckName) emit({ type: "draft_meta", ...scanner.meta });
          },
          onToolDone: (_i, b) => {
            if (b.name !== "submit_deck") emit({ type: "tool", id: b.id, name: b.name, label: toolLabel(b.name, b.input) });
          },
        },
        signal,
      );
    } catch (e) {
      if (opts.signal?.aborted) return lastDeck;
      if (timeout.aborted) break; // out of time
      throw e;
    }
    const u = msg.usage ?? {};
    usage.calls++;
    usage.input += u.input_tokens ?? 0;
    usage.cacheRead += u.cache_read_input_tokens ?? 0;
    usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    usage.output += u.output_tokens ?? 0;
    emit({ type: "usage", usage: { ...usage } });

    if (msg.stop_reason === "refusal") {
      emit({ type: "error", message: "Claude declined to build this deck. Try different seeds or wording." });
      return lastDeck;
    }
    // A tool call cut off by max_tokens: discard the turn and retry once with more room.
    if (msg.stop_reason === "max_tokens" && msg.content.some((b) => b.type === "tool_use")) {
      if (truncated++ === 0) {
        emit({ type: "status", text: "The list was cut off; asking Claude to write it again" });
        continue;
      }
    }
    const content = cleanAssistant(msg.content);
    const uses = content.filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use");
    if (!uses.length) {
      if (lastDeck) return lastDeck;
      if (nudged) break;
      nudged = true;
      if (content.length) messages.push({ role: "assistant", content });
      const nudge = "Please finish now: call submit_deck with the complete 100-card deck.";
      if (messages[messages.length - 1].role === "user") messages[messages.length - 1] = { role: "user", content: [...asBlocks(messages[messages.length - 1].content), { type: "text", text: nudge }] };
      else messages.push({ role: "user", content: nudge });
      continue;
    }
    messages.push({ role: "assistant", content });

    const late = Date.now() - started > soft;
    const lookups = uses.filter((x) => x.name !== "submit_deck" && x.name !== "revise_deck");
    const finals = uses.filter((x) => x.name === "submit_deck" || x.name === "revise_deck");
    const results = new Map<string, any>();

    await Promise.all(
      lookups.map(async (x, k) => {
        if (k >= MAX_PARALLEL_TOOLS) {
          emit({ type: "tool_result", id: x.id, summary: "skipped", ok: false });
          results.set(x.id, { type: "tool_result", tool_use_id: x.id, is_error: true, content: `Skipped: at most ${MAX_PARALLEL_TOOLS} lookups per turn.` });
          return;
        }
        results.set(x.id, await runLookup(x, emit, engine));
      }),
    );

    let done = false;
    for (const [k, x] of finals.entries()) {
      const reply = (content: string, isError = true) => results.set(x.id, { type: "tool_result", tool_use_id: x.id, is_error: isError || undefined, content });
      if (k > 0 || done) {
        reply("Only one submit_deck or revise_deck per turn; this one was ignored.");
        continue;
      }
      if (x.name === "revise_deck") {
        if (!reviewing || !lastDeck) {
          reply("revise_deck is only for the review round after an accepted deck. Use submit_deck.");
          continue;
        }
        revises++;
        const swaps: Swap[] = Array.isArray(x.input?.swaps) ? x.input.swaps.slice(0, 10) : [];
        if (!swaps.length) {
          emit({ type: "tool_result", id: x.id, summary: "kept as is", ok: true });
          reviewNote = String(x.input?.notes ?? "").trim() || "Review: no changes.";
          lastDeck.review = reviewNote;
          reply("ACCEPTED (unchanged).", false);
          done = true;
          continue;
        }
        const protect = [...seedNames, lastDeck.deck.commander.name, lastDeck.deck.partner?.name ?? ""].filter(Boolean);
        const base = toSubmission(lastDeck.deck);
        if (typeof x.input?.strategy === "string" && x.input.strategy.trim()) base.strategy = x.input.strategy.trim();
        const { sub, problems } = applySwaps(base, swaps, protect);
        let checked: Checked | null = null;
        if (!problems.length) {
          emit({ type: "status", text: `Checking ${swaps.length} review swap(s)` });
          try {
            checked = await checkSubmission(sub, 1, req, seedNames, engine);
          } catch (e) {
            problems.push(`Couldn't check the swaps: ${(e as Error).message}`);
          }
        }
        const errs = checked ? checked.validation.errors : problems;
        if (checked && checked.validation.ok) {
          emit({ type: "tool_result", id: x.id, summary: `${swaps.length} swap(s) accepted`, ok: true });
          emit({ type: "validation", validation: checked.validation, attempt: submits + revises });
          reviewNote = String(x.input?.notes ?? "").trim() || `Review: ${swaps.map((s) => `${s.out} → ${s.in}`).join(", ")}.`;
          lastDeck = { ...checked, review: reviewNote };
          reply("ACCEPTED", false);
          done = true;
        } else if (revises >= MAX_REVISES) {
          emit({ type: "tool_result", id: x.id, summary: "swaps rejected; kept the checked deck", ok: false });
          reply("The swaps didn't pass; keeping the deck that was already accepted.", false);
          done = true;
        } else {
          emit({ type: "tool_result", id: x.id, summary: `${errs.length} problem(s)`, ok: false });
          reply(`REJECTED — the swapped deck has problems. Send revise_deck again with corrected swaps (relative to the accepted deck), or an empty list to keep it:\n- ${errs.join("\n- ")}`);
        }
        continue;
      }
      // submit_deck
      submits++;
      const r = await runSubmit(x, submits, req, seedNames, emit, engine);
      results.set(x.id, r.result);
      if (!r.checked) continue;
      const final = r.checked.validation.ok || submits >= MAX_SUBMITS;
      if (!final) {
        if (!reviewing) lastDeck = r.checked; // best effort so far
        continue;
      }
      if (reviewing && !r.checked.validation.ok) {
        // a failed resubmission during the review keeps the accepted deck
        r.result.content = "The resubmitted deck didn't pass; keeping the deck that was already accepted.";
        r.result.is_error = undefined;
        done = true;
        continue;
      }
      lastDeck = r.checked;
      const canReview = engine.review && !reviewing && r.checked.validation.ok && left() > REVIEW_NEEDS_MS && !late;
      if (canReview) {
        reviewing = true;
        emit({ type: "status", text: "Deck is legal; Claude is reviewing it" });
        r.result.content = reviewRequest(r.checked);
      } else {
        r.result.content = "ACCEPTED";
        r.result.is_error = undefined;
        done = true;
      }
    }
    if (done && lastDeck) return lastDeck;

    const blocks = uses.map((x) => results.get(x.id));
    if (late && blocks.length) {
      const b = blocks[blocks.length - 1];
      b.content = `${b.content}\n\nTIME IS ALMOST UP: ${reviewing ? "send revise_deck now (or an empty list)" : "submit the complete deck with submit_deck"} in your next message.`;
    }
    messages.push({ role: "user", content: blocks });
  }
  if (lastDeck) return lastDeck;
  emit({ type: "error", message: "Claude didn't finish a deck in time. Try again; it usually works on a second run." });
  return null;
}

function reviewRequest(c: Checked): string {
  const parts = [
    "ACCEPTED — the deck is legal. One review round before it goes to the user.",
    "Independent analysis from the server:",
    analysisReport(c.analysis),
  ];
  if (c.combos) parts.push(comboNotes(c.combos));
  if (c.validation.warnings.length) parts.push(`Warnings: ${c.validation.warnings.join(" ")}`);
  parts.push(
    "Review the list as a strong Bracket 3 player would. Fix template gaps the counts show; swap generic staples and weak or off-plan cards for cards that make the seeds better; check the curve and the mana. Seeds and the commander stay.",
    "Then call revise_deck with up to 10 swaps (each removes one card and adds one), or with an empty swaps list if the deck is already right. Don't resubmit the whole deck.",
  );
  return parts.join("\n");
}

function asBlocks(c: any): any[] {
  return typeof c === "string" ? [{ type: "text", text: c }] : c;
}

async function runLookup(u: ContentBlock & { type: "tool_use" }, emit: (e: StreamEvent) => void, engine: EngineOptions) {
  try {
    if (u.name === "search_cards") {
      const r = await scry.search(String(u.input.query ?? ""), u.input.order ?? "edhrec", Math.min(Number(u.input.limit ?? 20) || 20, 40));
      emit({ type: "tool_result", id: u.id, summary: r.error ? "0 results" : `${r.total} matches`, ok: !r.error });
      const body = r.error ? `No results: ${r.error}` : `${r.total} total matches; showing ${r.cards.length}:\n${r.cards.map((c) => cardLine(c, engine.fullText ? "full" : "excerpt")).join("\n")}`;
      return { type: "tool_result", tool_use_id: u.id, content: body };
    }
    if (u.name === "get_cards") {
      const names: string[] = (Array.isArray(u.input.names) ? u.input.names : []).slice(0, 40).map(String);
      const { found, notFound } = await scry.getCollection(names);
      const cards = [...new Map([...found.values()].map((c) => [c.name, c])).values()];
      emit({ type: "tool_result", id: u.id, summary: `${cards.length} cards${notFound.length ? `, ${notFound.length} not found` : ""}`, ok: !notFound.length });
      const body = cards.map((c) => `${cardLine(c, "none")}\n  ${c.oracleText.replace(/\n/g, "\n  ")}`).join("\n") + (notFound.length ? `\nNOT FOUND: ${notFound.join("; ")}` : "");
      return { type: "tool_result", tool_use_id: u.id, content: body || "No cards." };
    }
    emit({ type: "tool_result", id: u.id, summary: "unknown tool", ok: false });
    return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` };
  } catch (e) {
    emit({ type: "tool_result", id: u.id, summary: "failed", ok: false });
    return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Tool error: ${(e as Error).message}` };
  }
}

async function runSubmit(u: ContentBlock & { type: "tool_use" }, attempt: number, req: GenerateRequest, seedNames: string[], emit: (e: StreamEvent) => void, engine: EngineOptions) {
  const sub = u.input as SubmittedDeck;
  if (!sub || !Array.isArray(sub.cards) || typeof sub.commander !== "string" || sub.cards.length > 150) {
    return { checked: null, result: { type: "tool_result", tool_use_id: u.id, is_error: true as boolean | undefined, content: "Invalid submission: a commander and a cards[] list (max 150 entries) are required." } };
  }
  try {
    emit({ type: "status", text: `Checking the deck with Scryfall (attempt ${attempt})` });
    const checked = await checkSubmission(sub, attempt, req, seedNames, engine);
    const { validation } = checked;
    emit({ type: "validation", validation, attempt });
    const final = validation.ok || attempt >= MAX_SUBMITS;
    const content = final
      ? "ACCEPTED"
      : `REJECTED — fix these and resubmit the whole deck:\n- ${validation.errors.join("\n- ")}${validation.warnings.length ? `\nWarnings (optional): ${validation.warnings.join(" ")}` : ""}`;
    return { checked, result: { type: "tool_result", tool_use_id: u.id, is_error: (!final || undefined) as boolean | undefined, content } };
  } catch (e) {
    return { checked: null, result: { type: "tool_result", tool_use_id: u.id, is_error: true as boolean | undefined, content: `Couldn't check the deck: ${(e as Error).message}. Resubmit it.` } };
  }
}

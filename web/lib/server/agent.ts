// The deckbuilding agent: Claude + the mtg-master skill + Scryfall tools + server-side validation.
import type { ModelCaller, ContentBlock } from "./anthropic";
import { DraftScanner } from "./draft-scanner";
import { TOOLS, systemPrompt, userPrompt } from "./prompt";
import * as scry from "./scryfall";
import { buildDeck, namesInSubmission, repairCount, validateDeck, type SubmittedDeck } from "./validate";
import type { CardInfo, Deck, GenerateRequest, Role, StreamEvent, Validation } from "../shared/types";
import { ROLES } from "../shared/types";

export interface AgentOptions {
  model: string;
  callModel: ModelCaller;
  emit: (e: StreamEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  timeBudgetMs?: number; // soft deadline: after this Claude is told to submit
  hardDeadlineMs?: number; // stop and return the best deck so far
}

const MAX_SUBMITS = 4;

function excerpt(t: string, n = 140) {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function cardLine(c: CardInfo, withText = true) {
  const bits = [
    c.name,
    c.manaCost || "—",
    c.typeLine,
    `id:${c.colorIdentity.join("") || "C"}`,
    c.priceEur != null ? `€${c.priceEur.toFixed(2)}` : c.priceUsd != null ? `$${c.priceUsd.toFixed(2)}` : "no price",
  ];
  if (c.gameChanger) bits.push("GAME CHANGER");
  if (c.legalCommander !== "legal") bits.push(`commander:${c.legalCommander}`);
  return bits.join(" | ") + (withText && c.oracleText ? ` :: ${excerpt(c.oracleText)}` : "");
}

function toolLabel(name: string, input: any): string {
  if (name === "search_cards") return String(input?.query ?? "");
  if (name === "get_cards") {
    const n: string[] = input?.names ?? [];
    return n.length <= 3 ? n.join(", ") : `${n.slice(0, 3).join(", ")} +${n.length - 3}`;
  }
  if (name === "submit_deck") return "Validating the full deck";
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

/** Keep only blocks the API accepts back: non-empty text, tool_use with real input, thinking with signature. */
function cleanAssistant(content: ContentBlock[]): ContentBlock[] {
  return content.filter((b: any) => (b.type === "text" ? b.text?.trim() : b.type === "tool_use" ? !b.input?.__invalid_json : b.type === "thinking" ? !!b.signature : false));
}

export async function runAgent(req: GenerateRequest, opts: AgentOptions): Promise<{ deck: Deck; validation: Validation } | null> {
  const { emit } = opts;
  const started = Date.now();
  const soft = opts.timeBudgetMs ?? 200_000; // after this, Claude is told to submit now
  const hard = opts.hardDeadlineMs ?? 268_000; // before Vercel's 300 s limit, with room to send the result
  const maxTurns = opts.maxTurns ?? 14;
  const left = () => hard - (Date.now() - started);

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

  const system = [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }];
  const messages: any[] = [{ role: "user", content: userPrompt(req, seeds) }];
  let submits = 0;
  let nudged = false;
  let truncated = 0;
  let lastDeck: { deck: Deck; validation: Validation } | null = null;

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
        { model: opts.model, max_tokens: truncated ? 32000 : 16000, system, messages: withCacheBreakpoint(messages), tools: TOOLS },
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
    const lookups = uses.filter((u) => u.name !== "submit_deck");
    const submissions = uses.filter((u) => u.name === "submit_deck");
    const results = new Map<string, any>();

    await Promise.all(
      lookups.map(async (u, k) => {
        if (k >= MAX_PARALLEL_TOOLS) {
          emit({ type: "tool_result", id: u.id, summary: "skipped", ok: false });
          results.set(u.id, { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Skipped: at most ${MAX_PARALLEL_TOOLS} lookups per turn.` });
          return;
        }
        results.set(u.id, await runLookup(u, emit));
      }),
    );

    let accepted = false;
    for (const [k, u] of submissions.entries()) {
      if (k > 0 || accepted) {
        results.set(u.id, { type: "tool_result", tool_use_id: u.id, is_error: true, content: "Only one submit_deck per turn; this one was ignored." });
        continue;
      }
      submits++;
      const r = await runSubmit(u, submits, req, seedNames, emit);
      if (r.deck) lastDeck = r.deck;
      accepted = r.final;
      results.set(u.id, r.result);
    }
    if (accepted && lastDeck) return lastDeck;

    const blocks = uses.map((u) => results.get(u.id));
    if (late && blocks.length) {
      const b = blocks[blocks.length - 1];
      b.content = `${b.content}\n\nTIME IS ALMOST UP: submit the complete deck with submit_deck in your next message.`;
    }
    messages.push({ role: "user", content: blocks });
  }
  if (lastDeck) return lastDeck;
  emit({ type: "error", message: "Claude didn't finish a deck in time. Try again; it usually works on a second run." });
  return null;
}

function asBlocks(c: any): any[] {
  return typeof c === "string" ? [{ type: "text", text: c }] : c;
}

async function runLookup(u: ContentBlock & { type: "tool_use" }, emit: (e: StreamEvent) => void) {
  try {
    if (u.name === "search_cards") {
      const r = await scry.search(String(u.input.query ?? ""), u.input.order ?? "edhrec", Math.min(Number(u.input.limit ?? 20) || 20, 40));
      emit({ type: "tool_result", id: u.id, summary: r.error ? "0 results" : `${r.total} matches`, ok: !r.error });
      const body = r.error ? `No results: ${r.error}` : `${r.total} total matches; showing ${r.cards.length}:\n${r.cards.map((c) => cardLine(c)).join("\n")}`;
      return { type: "tool_result", tool_use_id: u.id, content: body };
    }
    if (u.name === "get_cards") {
      const names: string[] = (Array.isArray(u.input.names) ? u.input.names : []).slice(0, 40).map(String);
      const { found, notFound } = await scry.getCollection(names);
      const cards = [...new Map([...found.values()].map((c) => [c.name, c])).values()];
      emit({ type: "tool_result", id: u.id, summary: `${cards.length} cards${notFound.length ? `, ${notFound.length} not found` : ""}`, ok: !notFound.length });
      const body = cards.map((c) => `${cardLine(c, false)}\n  ${c.oracleText.replace(/\n/g, "\n  ")}`).join("\n") + (notFound.length ? `\nNOT FOUND: ${notFound.join("; ")}` : "");
      return { type: "tool_result", tool_use_id: u.id, content: body || "No cards." };
    }
    emit({ type: "tool_result", id: u.id, summary: "unknown tool", ok: false });
    return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` };
  } catch (e) {
    emit({ type: "tool_result", id: u.id, summary: "failed", ok: false });
    return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Tool error: ${(e as Error).message}` };
  }
}

async function runSubmit(u: ContentBlock & { type: "tool_use" }, attempt: number, req: GenerateRequest, seedNames: string[], emit: (e: StreamEvent) => void) {
  const sub = u.input as SubmittedDeck;
  if (!sub || !Array.isArray(sub.cards) || typeof sub.commander !== "string" || sub.cards.length > 150) {
    return { final: false, deck: null, result: { type: "tool_result", tool_use_id: u.id, is_error: true, content: "Invalid submission: a commander and a cards[] list (max 150 entries) are required." } };
  }
  try {
    emit({ type: "status", text: `Checking the deck with Scryfall (attempt ${attempt})` });
    const { found, notFound } = await scry.getCollection(namesInSubmission(sub));
    const deck = buildDeck(sub, found, seedNames);
    const opts = { commander: req.commander };
    let validation = validateDeck(deck, notFound, seedNames, opts);
    // After a couple of tries, fix pure count problems ourselves.
    if (!validation.ok && attempt >= 2 && validation.errors.every((e) => e.startsWith("Deck has "))) {
      const note = repairCount(deck);
      if (note) {
        const basics = deck.cards.filter((c) => !c.info).map((c) => c.name);
        if (basics.length) {
          const extra = await scry.getCollection(basics);
          for (const c of deck.cards) if (!c.info) c.info = extra.found.get(c.name.toLowerCase());
        }
        validation = validateDeck(deck, notFound, seedNames, opts);
        validation.warnings.unshift(note);
      }
    }
    emit({ type: "validation", validation, attempt });
    const final = validation.ok || attempt >= MAX_SUBMITS;
    const content = final
      ? "ACCEPTED"
      : `REJECTED — fix these and resubmit the whole deck:\n- ${validation.errors.join("\n- ")}${validation.warnings.length ? `\nWarnings (optional): ${validation.warnings.join(" ")}` : ""}`;
    return { final, deck: { deck, validation }, result: { type: "tool_result", tool_use_id: u.id, is_error: !final || undefined, content } };
  } catch (e) {
    return { final: false, deck: null, result: { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Couldn't check the deck: ${(e as Error).message}. Resubmit it.` } };
  }
}

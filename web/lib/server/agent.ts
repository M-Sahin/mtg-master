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

export async function runAgent(req: GenerateRequest, opts: AgentOptions): Promise<{ deck: Deck; validation: Validation } | null> {
  const { emit } = opts;
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 210_000;
  const maxTurns = opts.maxTurns ?? 14;

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
  }
  const seedNames = seeds.map((s) => s.name);

  const system = [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }];
  const messages: any[] = [{ role: "user", content: userPrompt(req, seeds) }];
  let submits = 0;
  let nudged = false;
  let lastDeck: { deck: Deck; validation: Validation } | null = null;

  emit({ type: "status", text: "Claude is studying the seeds with the mtg-master skill" });

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) return null;
    const scanner = new DraftScanner();
    const msg = await opts.callModel(
      { model: opts.model, max_tokens: 16000, system, messages, tools: TOOLS },
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
          if (scanner.meta.commander !== hadMeta.commander || scanner.meta.deckName !== hadMeta.deckName) {
            emit({ type: "draft_meta", ...scanner.meta });
          }
        },
        onToolDone: (_i, b) => {
          if (b.name !== "submit_deck") emit({ type: "tool", id: b.id, name: b.name, label: toolLabel(b.name, b.input) });
        },
      },
      opts.signal,
    );
    messages.push({ role: "assistant", content: msg.content });

    const uses = msg.content.filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use");
    if (!uses.length) {
      if (lastDeck) return lastDeck;
      if (nudged || msg.stop_reason === "max_tokens") break;
      nudged = true;
      messages.push({ role: "user", content: "Please finish now: call submit_deck with the complete 100-card deck." });
      continue;
    }

    const late = Date.now() - started > budget;
    const results = await Promise.all(
      uses.map(async (u) => {
        try {
          if (u.name === "search_cards") {
            const r = await scry.search(String(u.input.query ?? ""), u.input.order ?? "edhrec", Math.min(Number(u.input.limit ?? 20), 40));
            const summary = r.error ? `0 results` : `${r.total} matches`;
            emit({ type: "tool_result", id: u.id, summary, ok: !r.error });
            const body = r.error ? `No results: ${r.error}` : `${r.total} total matches; showing ${r.cards.length}:\n${r.cards.map((c) => cardLine(c)).join("\n")}`;
            return { type: "tool_result", tool_use_id: u.id, content: body };
          }
          if (u.name === "get_cards") {
            const names: string[] = (u.input.names ?? []).slice(0, 40);
            const { found, notFound } = await scry.getCollection(names);
            const cards = [...new Map([...found.values()].map((c) => [c.name, c])).values()];
            emit({ type: "tool_result", id: u.id, summary: `${cards.length} cards${notFound.length ? `, ${notFound.length} not found` : ""}`, ok: !notFound.length });
            const body = cards.map((c) => `${cardLine(c, false)}\n  ${c.oracleText.replace(/\n/g, "\n  ")}`).join("\n") + (notFound.length ? `\nNOT FOUND: ${notFound.join("; ")}` : "");
            return { type: "tool_result", tool_use_id: u.id, content: body || "No cards." };
          }
          if (u.name === "submit_deck") {
            submits++;
            const sub = u.input as SubmittedDeck;
            if (!sub || !Array.isArray(sub.cards) || !sub.commander) {
              return { type: "tool_result", tool_use_id: u.id, is_error: true, content: "Invalid submission: commander and cards[] are required." };
            }
            emit({ type: "status", text: `Checking the deck with Scryfall (attempt ${submits})` });
            const { found, notFound } = await scry.getCollection(namesInSubmission(sub));
            const deck = buildDeck(sub, found, seedNames);
            let validation = validateDeck(deck, notFound, seedNames);
            // After a couple of tries, fix pure count problems ourselves.
            if (!validation.ok && submits >= 2 && validation.errors.every((e) => e.startsWith("Deck has "))) {
              const note = repairCount(deck);
              if (note) {
                const basics = deck.cards.filter((c) => !c.info).map((c) => c.name);
                if (basics.length) {
                  const extra = await scry.getCollection(basics);
                  for (const c of deck.cards) if (!c.info) c.info = extra.found.get(c.name.toLowerCase());
                }
                validation = validateDeck(deck, notFound, seedNames);
                validation.warnings.unshift(note);
              }
            }
            emit({ type: "validation", validation, attempt: submits });
            lastDeck = { deck, validation };
            if (validation.ok || submits >= MAX_SUBMITS) {
              return { type: "tool_result", tool_use_id: u.id, content: "ACCEPTED", __final: true };
            }
            return {
              type: "tool_result",
              tool_use_id: u.id,
              is_error: true,
              content: `REJECTED — fix these and resubmit the whole deck:\n- ${validation.errors.join("\n- ")}${validation.warnings.length ? `\nWarnings (optional): ${validation.warnings.join(" ")}` : ""}`,
            };
          }
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Unknown tool ${u.name}` };
        } catch (e) {
          emit({ type: "tool_result", id: u.id, summary: "failed", ok: false });
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: `Tool error: ${(e as Error).message}` };
        }
      }),
    );

    if (results.some((r: any) => r.__final) && lastDeck) return lastDeck;
    const clean = results.map(({ __final, ...r }: any) => r);
    if (late) clean.push({ type: "text", text: "Time is almost up: submit the complete deck with submit_deck now." } as any);
    messages.push({ role: "user", content: clean });
  }
  if (lastDeck) return lastDeck;
  emit({ type: "error", message: "Claude didn't finish a deck in time. Try again (or with fewer constraints)." });
  return null;
}

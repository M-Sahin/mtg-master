// Framework-independent handler for POST /api/generate (used by the Next.js route and tests).
import { LIMITS, clientIp, rateLimit, rateLimitAll, tooMany } from "./ratelimit";
import { cleanShape } from "../shared/shape";
import { anthropicCaller, friendlyModelError, listModels, type ModelCaller } from "./anthropic";
import { DEFAULT_MODEL, MODEL_ID } from "../shared/models";
import { JOB_ID, JobNotFound, jobExists, newJobId, startJob, stopJob, tailJob } from "./jobs";
import { runAgent } from "./agent";
import { serverConfig } from "./config";
import { DEMO_SEEDS, demoCaller } from "./demo";
import { claimFreeBuild, freeRefusal, freeStatus, visitor } from "./free-builds";
import { turnstileError, verifyTurnstile } from "./turnstile";
import { COOKIE, readCookies } from "./supabase";
import { saveBuildForUser } from "./account-handler";
import type { Budget, GenerateRequest, StreamEvent } from "../shared/types";
import { MAX_COLLECTION } from "../shared/types";

/** Claude API keys look like sk-ant-…; anything else is rejected before it reaches Anthropic. */
export const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

/** Best-effort client address (behind Vercel or a reverse proxy). */
export { clientIp };

/** Short, non-reversible tag for a key, so limits can be per key instead of per shared IP. */
async function keyTag(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_BODY = 1_500_000; // a 5000-card collection fits comfortably

export function parseRequest(body: any): GenerateRequest | string {
  if (!body || typeof body !== "object") return "Invalid request body.";
  const upgrade = body.mode === "upgrade";
  const complete = body.mode === "complete" || upgrade;
  const raw = Array.isArray(body.seeds) ? body.seeds.map((s: unknown) => String(s ?? "").trim()).filter(Boolean) : [];
  if (raw.some((s: string) => s.length > 150)) return "Card name too long.";
  const commander = body.commander ? String(body.commander).trim().slice(0, 150) : null;
  const bracket = ([1, 2, 3, 4] as const).find((b) => b === Number(body.bracket)) ?? 3;
  let seeds: string[];
  let extra: Partial<GenerateRequest> = {};
  if (complete) {
    seeds = [...new Map(raw.map((s: string) => [s.toLowerCase(), s])).values()] as string[];
    if (!commander) return upgrade ? "To upgrade a deck, it needs a commander." : "To complete a deck, it needs a commander.";
    if (upgrade && (seeds.length < 30 || seeds.length > 99)) return "To upgrade a deck, send its cards besides the commander (30 to 99 different cards).";
    if (!upgrade && (seeds.length < 1 || seeds.length > 98)) return "To complete a deck, send between 1 and 98 cards besides the commander.";
    const partner = body.partner ? String(body.partner).trim().slice(0, 150) : null;
    const basics: Record<string, number> = {};
    if (body.basics && typeof body.basics === "object")
      for (const [k, v] of Object.entries(body.basics)) if (/^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i.test(k)) basics[k] = Math.max(0, Math.min(99, Math.round(Number(v) || 0)));
    extra = { mode: upgrade ? "upgrade" : "complete", partner, basics };
  } else {
    seeds = raw;
    if (seeds.length !== 5) return "Pick exactly five seed cards.";
    if (new Set(seeds.map((s: string) => s.toLowerCase())).size !== 5) return "The five seed cards must be different.";
    if (commander && !seeds.some((s: string) => s.toLowerCase() === commander.toLowerCase())) return "The commander must be one of the seeds.";
  }
  const budget: Budget = ["any", "mid", "budget"].includes(body.budget) ? body.budget : "any";
  const theme = typeof body.theme === "string" ? body.theme.slice(0, 300) : undefined;
  let collection: GenerateRequest["collection"];
  if (body.collection && Array.isArray(body.collection.names)) {
    const names = [...new Set((body.collection.names as unknown[]).map((n) => String(n ?? "").trim().slice(0, 150)).filter(Boolean))];
    if (names.length > MAX_COLLECTION) return `Collections can have up to ${MAX_COLLECTION} different cards.`;
    if (names.length) collection = { names, mode: body.collection.mode === "only" ? "only" : "prefer" };
  }
  const shape = cleanShape(body.shape);
  if (typeof shape === "string") return shape;
  return { seeds, commander, budget, theme, bracket, ...extra, ...(collection ? { collection } : {}), ...(shape ? { shape } : {}) };
}


export interface GenerateOverride {
  callModel?: ModelCaller;
  demoSpeed?: number;
  /** Keeps the server working after the response (Next's after() / Vercel's waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
}

const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };

/** Stream a job's events as NDJSON lines ({...event, i}); the browser leaving only ends this stream, not the build. */
function tailResponse(id: string, from: number, first?: StreamEvent): Response {
  const encoder = new TextEncoder();
  const ctl = new AbortController();
  const stream = new ReadableStream({
    cancel() {
      ctl.abort();
    },
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          ctl.abort(); // client went away
        }
      };
      if (first) send(first);
      // an immediate line, then a heartbeat every 5 s: the browser can tell a live but quiet
      // connection from a dead one, and proxies don't close it while Claude thinks
      send({ type: "status", text: "" });
      const ping = setInterval(() => send({ type: "status", text: "" }), 5000);
      try {
        for await (const { i, event } of tailJob(id, from, ctl.signal)) send({ ...event, i });
      } catch (e) {
        send({ type: "error", message: e instanceof JobNotFound ? e.message : "Lost track of the build." });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: NDJSON_HEADERS });
}

/** GET /api/generate?job=<id>&from=<n>: reconnect to a running (or just finished) build. */
export async function handleResume(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const id = u.searchParams.get("job") ?? "";
  const from = Math.max(0, Number(u.searchParams.get("from")) || 0);
  if (!JOB_ID.test(id)) return Response.json({ error: "Unknown build." }, { status: 400 });
  // check it exists before streaming, so the browser can tell "gone" from "connection trouble"
  if (!(await jobExists(id))) return Response.json({ error: new JobNotFound().message }, { status: 404 });
  return tailResponse(id, from);
}

/** POST /api/generate/stop {job}: the "Stop building" button. */
export async function handleStop(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.job === "string" ? body.job : "";
  if (!JOB_ID.test(id)) return Response.json({ error: "Unknown build." }, { status: 400 });
  await stopJob(id);
  return Response.json({ ok: true });
}

export async function handleGenerate(request: Request, override?: GenerateOverride): Promise<Response> {
  const cfg = serverConfig();
  const ip = clientIp(request);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "Request too large." }, { status: 413 });
  // the visitor's own key: used for this build only, never stored or logged
  const userKey = (request.headers.get("x-anthropic-key") ?? "").trim();
  if (userKey) {
    if (!cfg.ownKeys) return Response.json({ error: "This site doesn't accept personal API keys." }, { status: 403 });
    if (!KEY_PATTERN.test(userKey)) return Response.json({ error: "That doesn't look like a Claude API key (they start with sk-ant-)." }, { status: 400 });
    const r = await rateLimitAll([
      [LIMITS.buildOwnKey(cfg.ownKeyBuildsPerHour), await keyTag(userKey)],
      [LIMITS.buildOwnKeyIp, ip],
    ]);
    if (!r.ok) return tooMany(`You've started a lot of builds in the last hour (the limit is ${cfg.ownKeyBuildsPerHour}). Try again later.`, r);
  } else if (cfg.free && !override?.callModel) {
    // free builds: limited per visitor below, once the request is known to be valid
    const r = await rateLimit(LIMITS.buildServerKey(cfg.buildsPerHour), ip);
    if (!r.ok) return tooMany(`You've built ${cfg.buildsPerHour} decks in the last hour. Try again later.`, r);
  } else if (!cfg.demo && !override?.callModel) {
    if (!cfg.accessCode && !cfg.publicAccess) {
      return Response.json({ error: "This deployment has an API key but no ACCESS_CODE. Set ACCESS_CODE (or PUBLIC_ACCESS=1) in the Vercel project settings." }, { status: 503 });
    }
    if (cfg.accessCode && request.headers.get("x-access-code") !== cfg.accessCode) {
      return Response.json({ error: "Wrong or missing access code." }, { status: 401 });
    }
    const r = await rateLimit(LIMITS.buildServerKey(cfg.buildsPerHour), ip);
    if (!r.ok) return tooMany(`You've built ${cfg.buildsPerHour} decks in the last hour. Try again later.`, r);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const req = parseRequest(body);
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });

  const demo = cfg.demo && !userKey;
  if (demo && !override?.callModel && (req.mode === "complete" || req.mode === "upgrade")) {
    return Response.json({ error: `${req.mode === "upgrade" ? "Upgrading" : "Completing"} a deck needs a Claude API key. Add your own key above to use it.` }, { status: 400 });
  }
  if (demo && !override?.callModel) {
    const same = req.seeds.map((s) => s.toLowerCase()).sort().join("|") === DEMO_SEEDS.map((s) => s.toLowerCase()).sort().join("|");
    if (!same) {
      return Response.json(
        { error: cfg.ownKeys ? "Without an API key, only the demo deck can be built. Add your own Claude API key to build any deck." : "Demo mode only builds the sample Meren deck. Load the demo seeds, or set ANTHROPIC_API_KEY for real builds." },
        { status: 400 },
      );
    }
    req.commander = "Meren of Clan Nel Toth";
    req.bracket = 3; // the scripted demo deck is a Bracket 3 deck
    delete req.shape; // and it can't follow deck-shape limits
  }
  // a free build: the visitor's bot check, then one of their free builds
  const free = !userKey && !demo && cfg.free ? cfg.free : null;
  const headers = new Headers();
  let refund: (() => Promise<void>) | null = null;
  if (free && !override?.callModel) {
    const human = await verifyTurnstile((body as any)?.turnstile, ip, "build");
    if (!human.ok) return turnstileError(human);
    const v = visitor(request);
    if (v.setCookie) headers.append("set-cookie", v.setCookie);
    const claim = await claimFreeBuild(free, v);
    if (!claim.ok) return Response.json({ error: freeRefusal(claim.reason, free), code: "free_used" }, { status: 402, headers });
    refund = claim.refund;
  }
  const wanted = typeof (body as any)?.model === "string" ? String((body as any).model).trim() : "";
  // free builds always use the free model: stronger ones need the visitor's own key
  const model = userKey ? (MODEL_ID.test(wanted) ? wanted : DEFAULT_MODEL) : free ? free.model : cfg.model;
  const callModel = override?.callModel ?? (userKey ? anthropicCaller(userKey) : demo ? demoCaller(override?.demoSpeed ?? 1) : anthropicCaller(cfg.apiKey));
  const engine = demo ? cfg.engine : free ? { ...cfg.liveEngine, effort: free.effort as typeof cfg.liveEngine.effort } : cfg.liveEngine;
  const id = newJobId();
  const started = Date.now();
  // logged in: the finished deck also goes straight into the account (the browser may be gone by then)
  const token = demo ? null : (readCookies(request)[COOKIE.access] ?? null);
  const run = startJob(id, async (emitRaw, signal) => {
    let usage: Record<string, number> | undefined;
    const emit = (e: StreamEvent) => {
      if (e.type === "usage") usage = { ...e.usage };
      emitRaw(e);
    };
    try {
      // free builds are told to wrap up sooner: a smaller model at high effort can run long, and a
      // build that hits the hard deadline without a deck is a wasted wait
      const result = await runAgent(req, { model: demo ? "demo" : model, callModel, emit, signal, engine, ...(free ? { timeBudgetMs: 150_000 } : {}) });
      if (result) emit({ type: "deck", deck: result.deck, validation: result.validation, analysis: result.analysis, review: result.review, ...(result.swaps ? { swaps: result.swaps } : {}) });
      if (result && token) await saveBuildForUser(token, result.deck, userKey ? { model, usage } : { model }).catch(() => false);
      // no deck and not stopped by the visitor: the free build doesn't count
      else if (!signal.aborted) await refund?.();
    } catch (e) {
      if (!signal.aborted) await refund?.();
      emit({ type: "error", message: friendlyModelError(e, !!userKey) || "Something went wrong." });
    } finally {
      emit({ type: "done", ms: Date.now() - started });
    }
  });
  override?.waitUntil?.(run);
  const res = tailResponse(id, 0, { type: "job", id });
  headers.forEach((v, k) => res.headers.append(k, v));
  return res;
}

/** GET /api/free-builds: how many free builds this visitor has left (and a browser id, if new). */
export async function handleFreeStatus(request: Request): Promise<Response> {
  const cfg = serverConfig();
  if (!cfg.free) return Response.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
  const v = visitor(request);
  const status = await freeStatus(cfg.free, v);
  const headers = new Headers({ "cache-control": "no-store" });
  if (v.setCookie) headers.append("set-cookie", v.setCookie);
  return Response.json({ enabled: true, ...status }, { headers });
}

/** POST /api/key/check {key}: does this key work, and which models can it use? The key isn't stored. */
export async function handleKeyCheck(request: Request): Promise<Response> {
  const cfg = serverConfig();
  if (!cfg.ownKeys) return Response.json({ error: "This site doesn't accept personal API keys." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 10_000) return Response.json({ error: "Request too large." }, { status: 413 });
  const body = await request.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!KEY_PATTERN.test(key)) return Response.json({ error: "That doesn't look like a Claude API key. Keys start with sk-ant-." }, { status: 400 });
  // per IP and key together (people behind one shared address don't block each other), and per
  // IP overall (so nobody can test a list of stolen keys through this server)
  const ip = clientIp(request);
  const r = await rateLimitAll([
    [LIMITS.keyCheck, `${ip}:${await keyTag(key)}`],
    [LIMITS.keyCheckIp, ip],
  ]);
  if (!r.ok) return tooMany("Too many key checks. Try again later.", r);
  try {
    const models = await listModels(key);
    return Response.json({ ok: true, models }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendlyModelError(e) }, { status: 400 });
  }
}

// Framework-independent handler for POST /api/generate (used by the Next.js route and tests).
import { anthropicCaller, type ModelCaller } from "./anthropic";
import { JOB_ID, JobNotFound, jobExists, newJobId, startJob, stopJob, tailJob } from "./jobs";
import { runAgent } from "./agent";
import { serverConfig } from "./config";
import { DEMO_SEEDS, demoCaller } from "./demo";
import type { Budget, GenerateRequest, StreamEvent } from "../shared/types";

export function parseRequest(body: any): GenerateRequest | string {
  if (!body || typeof body !== "object") return "Invalid request body.";
  const seeds = Array.isArray(body.seeds) ? body.seeds.map((s: unknown) => String(s ?? "").trim()).filter(Boolean) : [];
  if (seeds.length !== 5) return "Pick exactly five seed cards.";
  if (new Set(seeds.map((s: string) => s.toLowerCase())).size !== 5) return "The five seed cards must be different.";
  if (seeds.some((s: string) => s.length > 150)) return "Card name too long.";
  const commander = body.commander ? String(body.commander).trim() : null;
  if (commander && !seeds.some((s: string) => s.toLowerCase() === commander.toLowerCase())) return "The commander must be one of the seeds.";
  const budget: Budget = ["any", "mid", "budget"].includes(body.budget) ? body.budget : "any";
  const theme = typeof body.theme === "string" ? body.theme.slice(0, 300) : undefined;
  return { seeds, commander, budget, theme };
}

// Per-instance rate limit (best effort: each warm Vercel instance keeps its own counts).
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, perHour: number, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= perHour) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return false;
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
  if (!cfg.demo && !override?.callModel) {
    if (!cfg.accessCode && !cfg.publicAccess) {
      return Response.json({ error: "This deployment has an API key but no ACCESS_CODE. Set ACCESS_CODE (or PUBLIC_ACCESS=1) in the Vercel project settings." }, { status: 503 });
    }
    if (cfg.accessCode && request.headers.get("x-access-code") !== cfg.accessCode) {
      return Response.json({ error: "Wrong or missing access code." }, { status: 401 });
    }
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
    if (rateLimited(ip, cfg.buildsPerHour)) {
      return Response.json({ error: `You've built ${cfg.buildsPerHour} decks in the last hour. Try again later.` }, { status: 429 });
    }
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const req = parseRequest(body);
  if (typeof req === "string") return Response.json({ error: req }, { status: 400 });

  if (cfg.demo && !override?.callModel) {
    const same = req.seeds.map((s) => s.toLowerCase()).sort().join("|") === DEMO_SEEDS.map((s) => s.toLowerCase()).sort().join("|");
    if (!same) {
      return Response.json({ error: "Demo mode only builds the sample Meren deck. Load the demo seeds, or set ANTHROPIC_API_KEY for real builds." }, { status: 400 });
    }
    req.commander = "Meren of Clan Nel Toth";
  }

  const callModel = override?.callModel ?? (cfg.demo ? demoCaller(override?.demoSpeed ?? 1) : anthropicCaller(cfg.apiKey));
  const id = newJobId();
  const started = Date.now();
  const run = startJob(id, async (emit, signal) => {
    try {
      const result = await runAgent(req, { model: cfg.model, callModel, emit, signal, engine: cfg.engine });
      if (result) emit({ type: "deck", deck: result.deck, validation: result.validation, analysis: result.analysis, review: result.review });
    } catch (e) {
      emit({ type: "error", message: (e as Error).message || "Something went wrong." });
    } finally {
      emit({ type: "done", ms: Date.now() - started });
    }
  });
  override?.waitUntil?.(run);
  return tailResponse(id, 0, { type: "job", id });
}

// Framework-independent handler for POST /api/generate (used by the Next.js route and tests).
import { anthropicCaller, type ModelCaller } from "./anthropic";
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

export async function handleGenerate(request: Request, override?: { callModel?: ModelCaller; demoSpeed?: number }): Promise<Response> {
  const cfg = serverConfig();
  if (cfg.accessCode && !cfg.demo && request.headers.get("x-access-code") !== cfg.accessCode) {
    return Response.json({ error: "Wrong or missing access code." }, { status: 401 });
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
  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      // keep proxies from closing an idle connection while Claude thinks
      const ping = setInterval(() => emit({ type: "status", text: "" }), 15000);
      try {
        const result = await runAgent(req, { model: cfg.model, callModel, emit, signal: request.signal });
        if (result) emit({ type: "deck", deck: result.deck, validation: result.validation });
      } catch (e) {
        emit({ type: "error", message: (e as Error).message || "Something went wrong." });
      } finally {
        clearInterval(ping);
        emit({ type: "done", ms: Date.now() - started });
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

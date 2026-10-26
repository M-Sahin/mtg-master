// One rate limiter for every route that costs something (Claude, Scryfall, email, storage).
// With the Upstash store configured (lib/server/store.ts), counts are shared by every server
// instance, so a script can't get around a limit by landing on fresh instances. Without it, each
// instance counts on its own (fine for one Docker container).
//
// Fixed windows: INCR a key named after the window, which expires with it. Keys are hashed, so
// the store never holds IP addresses, emails or user ids.
import { kvConfig } from "./store";

export interface LimitResult {
  ok: boolean;
  /** seconds until the window resets */
  retryAfter: number;
}

export interface LimitRule {
  kind: string;
  max: number;
  /** window length in seconds (default an hour) */
  window?: number;
}

type Fetch = typeof fetch;

/** The client's address: Vercel's own header first (clients can't set it), IPv6 by /64 network. */
export function clientIp(request: Request): string {
  const h = request.headers;
  const raw = (process.env.VERCEL ? h.get("x-real-ip") : null) ?? (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ?? "";
  const ip = raw || h.get("x-real-ip")?.trim() || "unknown";
  // one IPv6 user can have a whole /64 network: count it as one address
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

async function hash(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hf-rl:${s}`)));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- per-instance fallback ----------------------------------------------------------
const memory = new Map<string, Map<string, { bucket: number; n: number }>>();
function memoryHit(kind: string, key: string, bucket: number): number {
  const m = memory.get(kind) ?? new Map();
  memory.set(kind, m);
  const cur = m.get(key);
  const n = cur && cur.bucket === bucket ? cur.n + 1 : 1;
  m.set(key, { bucket, n });
  if (m.size > 5000) m.delete(m.keys().next().value as string);
  return n;
}
export function resetRateLimits() {
  memory.clear();
}

let warned = false;

/** Count one request for `key` under `rule`; ok = still within the limit. */
export async function rateLimit(rule: LimitRule, key: string, deps: { fetch?: Fetch; now?: number } = {}): Promise<LimitResult> {
  const window = rule.window ?? 3600;
  const now = deps.now ?? Date.now();
  const bucket = Math.floor(now / 1000 / window);
  const retryAfter = Math.max(1, Math.ceil((bucket + 1) * window - now / 1000));
  const id = await hash(key);
  const kv = kvConfig();
  let n: number;
  if (kv) {
    try {
      const k = `hf:rl:${rule.kind}:${bucket}:${id}`;
      const res = await (deps.fetch ?? fetch)(`${kv.url}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${kv.token}`, "content-type": "application/json" },
        body: JSON.stringify([
          ["INCR", k],
          ["EXPIRE", k, window + 60],
        ]),
        signal: AbortSignal.timeout(3000),
      });
      const j = (await res.json()) as { result?: unknown; error?: string }[];
      const count = Number(j?.[0]?.result);
      if (!res.ok || !Number.isFinite(count)) throw new Error(j?.[0]?.error ?? `HTTP ${res.status}`);
      n = count;
    } catch (e) {
      // the store is down: keep limiting on this instance rather than not at all
      if (!warned) console.warn(`rate limit store unavailable, counting per instance: ${(e as Error).message}`);
      warned = true;
      n = memoryHit(rule.kind, id, bucket);
    }
  } else n = memoryHit(rule.kind, id, bucket);
  return { ok: n <= rule.max, retryAfter };
}

/** Check several limits at once (e.g. per IP and per email); the first one over wins. */
export async function rateLimitAll(checks: [LimitRule, string][], deps?: { fetch?: Fetch; now?: number }): Promise<LimitResult> {
  const results = await Promise.all(checks.map(([rule, key]) => rateLimit(rule, key, deps)));
  return results.find((r) => !r.ok) ?? { ok: true, retryAfter: 0 };
}

/** A 429 with Retry-After and a readable message. */
export function tooMany(message: string, r: LimitResult, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("retry-after", String(r.retryAfter));
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify({ error: message }), { status: 429, headers: h });
}

/** The limits, in one place so they're easy to tune. Per hour unless a window is given. */
export const LIMITS = {
  buildServerKey: (max: number): LimitRule => ({ kind: "build-ip", max }),
  buildOwnKey: (max: number): LimitRule => ({ kind: "build-key", max }),
  buildOwnKeyIp: { kind: "build-own-ip", max: 60 },
  keyCheck: { kind: "keycheck", max: 30 },
  keyCheckIp: { kind: "keycheck-ip", max: 60 },
  bracket: { kind: "bracket", max: 40 },
  cardOffers: { kind: "card-offers", max: 300 },
  autocomplete: { kind: "autocomplete", max: 900 },
  named: { kind: "named", max: 300 },
  random: { kind: "random", max: 120 },
  resolve: { kind: "resolve", max: 120 },
  og: { kind: "og", max: 600 },
  share: { kind: "share", max: 60 },
  evDeck: { kind: "ev-deck", max: 120 },
  loginEmailIp: { kind: "email-ip", max: 10 },
  loginEmail: { kind: "email", max: 3 },
  deckSave: { kind: "save", max: 120 },
  deckSaveIp: { kind: "save-ip", max: 300 },
  accountDelete: { kind: "delete", max: 10 },
} satisfies Record<string, LimitRule | ((n: number) => LimitRule)>;

/** For a route: null when the request may go ahead, else the 429 to send. Counted per IP. */
export async function guard(request: Request, rule: LimitRule, message = "Too many requests. Try again in a bit."): Promise<Response | null> {
  const r = await rateLimit(rule, clientIp(request));
  return r.ok ? null : tooMany(message, r);
}

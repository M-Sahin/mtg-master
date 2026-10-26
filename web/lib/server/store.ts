// Optional key-value store for short share links (/d/<id>), via the Upstash Redis REST API.
// Configure with the variables Vercel's Upstash integration sets (KV_REST_API_URL and
// KV_REST_API_TOKEN), or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Without them,
// share links stay self-contained (/deck?d=…). No SDK: one fetch per command.

const TTL_SECONDS = 60 * 60 * 24 * 365; // a year, renewed whenever the link is opened
const KEY = (id: string) => `hf:deck:${id}`;

export function kvConfig(): { url: string; token: string } | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

export async function kv(cmd: (string | number)[]): Promise<unknown> {
  const cfg = kvConfig();
  if (!cfg) throw new Error("No store configured");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  });
  const j = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || j.error) throw new Error(`Store error: ${j.error ?? `HTTP ${res.status}`}`);
  return j.result;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ID_PATTERN = /^[0-9A-Za-z]{6,16}$/;

/** Short id derived from the deck itself: sharing the same deck twice gives the same link. */
export async function shareId(d: string, length = 9): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(d)));
  let n = 0n;
  for (const b of hash.slice(0, 12)) n = (n << 8n) | BigInt(b);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += ALPHABET[Number(n % 62n)];
    n /= 62n;
  }
  return id;
}

/**
 * Store a deck for a short link. Never overwrites another deck: if the id is taken by a different
 * deck (a hash collision, or someone who went looking for one), a longer id is used.
 */
export async function saveShare(d: string): Promise<string> {
  for (const length of [9, 12, 16]) {
    const id = await shareId(d, length);
    const set = await kv(["SET", KEY(id), d, "EX", TTL_SECONDS, "NX"]);
    if (set === "OK") return id;
    const there = await kv(["GETEX", KEY(id), "EX", TTL_SECONDS]);
    if (there === d) return id; // the same deck shared again: same link, a year longer
  }
  throw new Error("Couldn't make a short link for this deck.");
}

export async function loadShare(id: string): Promise<string | null> {
  if (!ID_PATTERN.test(id) || !kvConfig()) return null;
  const v = await kv(["GETEX", KEY(id), "EX", TTL_SECONDS]);
  return typeof v === "string" ? v : null;
}

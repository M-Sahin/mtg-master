// Minimal server-side Scryfall client (port of mtg-master/scripts/scryfall.py).
// Scryfall asks for a User-Agent + Accept header and <= 10 requests/second.
import type { CardInfo, Color } from "../shared/types";

const API = "https://api.scryfall.com";
const HEADERS = {
  "User-Agent": "hundredfold-mtg-master/1.0 (+https://github.com/M-Sahin/mtg-master)",
  Accept: "application/json",
};

// Requests go through one queue so parallel tool calls still respect Scryfall's spacing.
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
function slot(): Promise<void> {
  const next = queue.then(async () => {
    const wait = 110 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  });
  queue = next.catch(() => {});
  return next;
}

export class ScryfallError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// Small in-memory cache of *mapped* results (warm function instances reuse it).
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 1000 * 60 * 60 * 6;
async function cached<T>(key: string, fn: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await fn();
  if (keep(value)) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 600) cache.delete(cache.keys().next().value as string);
  }
  return value;
}

async function request<T = any>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot();
    let res: Response;
    try {
      res = await fetch(path.startsWith("http") ? path : API + path, {
        method: body ? "POST" : "GET",
        headers: body ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new ScryfallError(`Can't reach Scryfall: ${(e as Error).message}`);
    }
    if (res.status === 429 || res.status >= 500) {
      // rate limited / overloaded: back off and retry instead of reporting "no results"
      const after = Number(res.headers.get("retry-after")) || 1 + attempt;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, Math.min(after, 5) * 1000));
        continue;
      }
      throw new ScryfallError(`Scryfall is busy (HTTP ${res.status}). Try again in a minute.`, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ScryfallError(`Scryfall returned HTTP ${res.status}`, res.status);
    }
  }
  throw new ScryfallError("Scryfall request failed");
}

function faceText(c: any): string {
  if (c.card_faces?.length && !c.oracle_text) {
    return c.card_faces
      .map((f: any) => `[${f.name}] ${f.mana_cost ?? ""} — ${f.type_line ?? ""}\n${f.oracle_text ?? ""}`)
      .join("\n");
  }
  return c.oracle_text ?? "";
}

export function toCardInfo(c: any): CardInfo {
  const front = String(c.type_line ?? "").split("//")[0];
  const text = faceText(c);
  const img = c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {};
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    name: c.name,
    manaCost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? "",
    cmc: Number(c.cmc ?? 0),
    typeLine: c.type_line ?? "",
    oracleText: text,
    colorIdentity: (c.color_identity ?? []) as Color[],
    legalCommander: c.legalities?.commander ?? "not_legal",
    canBeCommander:
      /can be your commander/i.test(text) || (/Legendary/.test(front) && /Creature/.test(front)),
    gameChanger: Boolean(c.game_changer),
    priceEur: num(c.prices?.eur),
    priceUsd: num(c.prices?.usd),
    image: img.normal ?? null,
    artCrop: img.art_crop ?? null,
    scryfallUri: String(c.scryfall_uri ?? "").split("?")[0],
    edhrecRank: c.edhrec_rank ?? null,
  };
}

const cardCache = new Map<string, { at: number; info: CardInfo }>();

/**
 * Batch lookup by name (75 per request). The returned map is keyed by the lower-cased
 * REQUESTED name as well as each card's full and face names. A requested name that
 * Scryfall answered under a different spelling is resolved with a fuzzy lookup, so
 * every requested name ends up either in `found` or in `notFound`.
 */
export async function getCollection(names: string[]) {
  const found = new Map<string, CardInfo>();
  const notFound: string[] = [];
  const unique = [...new Map(names.map((n) => n.trim()).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  const put = (info: CardInfo, ...keys: string[]) => {
    for (const k of keys) if (!found.has(k.toLowerCase())) found.set(k.toLowerCase(), info);
  };
  const todo: string[] = [];
  for (const n of unique) {
    const hit = cardCache.get(n.toLowerCase());
    if (hit && Date.now() - hit.at < TTL) put(hit.info, n);
    else todo.push(n);
  }
  // Scryfall's /cards/collection doesn't match the full "Front // Back" name of double-faced
  // cards, so ask for the front face and map the answer back to the requested name.
  const front = (n: string) => n.split(/\s+\/\/?\s+/)[0].trim();
  for (let i = 0; i < todo.length; i += 75) {
    const chunk = todo.slice(i, i + 75);
    const ids = [...new Map(chunk.map((n) => [front(n).toLowerCase(), front(n)])).values()];
    const res = await request<any>("/cards/collection", { identifiers: ids.map((name) => ({ name })) });
    if (res.object === "error") throw new ScryfallError(res.details ?? "collection error");
    for (const c of res.data ?? []) {
      const info = toCardInfo(c);
      put(info, c.name, ...(c.card_faces ?? []).map((f: any) => f.name));
    }
    for (const n of chunk) {
      let info = found.get(n.toLowerCase()) ?? found.get(front(n).toLowerCase());
      // still unknown: exact lookup (handles "A // B" and odd spellings), then fuzzy
      if (!info) info = (await named(n)) ?? undefined;
      if (info) {
        put(info, n);
        cardCache.set(n.toLowerCase(), { at: Date.now(), info });
        if (cardCache.size > 5000) cardCache.delete(cardCache.keys().next().value as string);
      } else notFound.push(n);
    }
  }
  return { found, notFound };
}

export interface SearchResult {
  total: number;
  cards: CardInfo[];
  error?: string;
}

export async function search(q: string, order = "edhrec", limit = 25): Promise<SearchResult> {
  const params = new URLSearchParams({ q: q.slice(0, 400), order, unique: "cards" });
  const all = await cached(`search:${params}`, async (): Promise<SearchResult> => {
    const res = await request<any>(`/cards/search?${params}`);
    // a 404 error object here just means "no matches"
    if (res.object === "error") return { total: 0, cards: [], error: res.details };
    return { total: res.total_cards ?? 0, cards: (res.data ?? []).slice(0, 40).map(toCardInfo) };
  });
  return { ...all, cards: all.cards.slice(0, limit) };
}

export async function named(name: string, fuzzy = false): Promise<CardInfo | null> {
  return cached(`named:${fuzzy}:${name.toLowerCase()}`, async () => {
    const res = await request<any>(`/cards/named?${fuzzy ? "fuzzy" : "exact"}=${encodeURIComponent(name)}`);
    if (res.object === "error") return fuzzy ? null : named(name, true);
    return toCardInfo(res);
  });
}

export async function autocomplete(q: string): Promise<string[]> {
  if (q.trim().length < 2) return [];
  return cached(`ac:${q.toLowerCase()}`, async () => {
    const res = await request<any>(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
    return (res.data ?? []) as string[];
  });
}

export async function random(q: string): Promise<CardInfo | null> {
  const res = await request<any>(`/cards/random?q=${encodeURIComponent(q)}`);
  return res.object === "card" ? toCardInfo(res) : null;
}

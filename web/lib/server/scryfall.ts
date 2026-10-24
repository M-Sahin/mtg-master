// Minimal server-side Scryfall client (port of mtg-master/scripts/scryfall.py).
// Scryfall asks for a User-Agent + Accept header and <= 10 requests/second.
import type { CardInfo, Color } from "../shared/types";

const API = "https://api.scryfall.com";
const HEADERS = {
  "User-Agent": "hundredfold-mtg-master/1.0 (+https://github.com/M-Sahin/mtg-master)",
  Accept: "application/json",
};

let last = 0;
async function throttle() {
  const wait = 110 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

export class ScryfallError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// Small in-memory cache: warm function instances reuse it across requests.
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 1000 * 60 * 60 * 6;

async function request<T = any>(path: string, body?: unknown): Promise<T> {
  const key = body ? `${path}::${JSON.stringify(body)}` : path;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  await throttle();
  let res: Response;
  try {
    res = await fetch(path.startsWith("http") ? path : API + path, {
      method: body ? "POST" : "GET",
      headers: body ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ScryfallError(`Can't reach Scryfall: ${(e as Error).message}`);
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ScryfallError(`Scryfall returned HTTP ${res.status}`, res.status);
  }
  if (res.ok && !path.includes("/random")) {
    cache.set(key, { at: Date.now(), value: json });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  }
  return json as T;
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

/** Batch lookup by exact name (75 per request). Keys are lower-cased full AND face names. */
export async function getCollection(names: string[]) {
  const found = new Map<string, CardInfo>();
  const notFound: string[] = [];
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 75) {
    const chunk = unique.slice(i, i + 75);
    const res = await request<any>("/cards/collection", { identifiers: chunk.map((name) => ({ name })) });
    if (res.object === "error") throw new ScryfallError(res.details ?? "collection error");
    for (const c of res.data ?? []) {
      const info = toCardInfo(c);
      found.set(c.name.toLowerCase(), info);
      for (const f of c.card_faces ?? []) if (!found.has(f.name.toLowerCase())) found.set(f.name.toLowerCase(), info);
    }
    for (const nf of res.not_found ?? []) notFound.push(nf.name ?? JSON.stringify(nf));
  }
  return { found, notFound };
}

export interface SearchResult {
  total: number;
  cards: CardInfo[];
  error?: string;
}

export async function search(q: string, order = "edhrec", limit = 25): Promise<SearchResult> {
  const params = new URLSearchParams({ q, order, unique: "cards" });
  const res = await request<any>(`/cards/search?${params}`);
  if (res.object === "error") {
    // 404 here just means "no matches"
    return { total: 0, cards: [], error: res.details };
  }
  return { total: res.total_cards ?? 0, cards: (res.data ?? []).slice(0, limit).map(toCardInfo) };
}

export async function named(name: string, fuzzy = false): Promise<CardInfo | null> {
  const res = await request<any>(`/cards/named?${fuzzy ? "fuzzy" : "exact"}=${encodeURIComponent(name)}`);
  if (res.object === "error") {
    if (!fuzzy) return named(name, true);
    return null;
  }
  return toCardInfo(res);
}

export async function autocomplete(q: string): Promise<string[]> {
  if (q.trim().length < 2) return [];
  const res = await request<any>(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
  return res.data ?? [];
}

export async function random(q: string): Promise<CardInfo | null> {
  const res = await request<any>(`/cards/random?q=${encodeURIComponent(q)}`);
  return res.object === "card" ? toCardInfo(res) : null;
}

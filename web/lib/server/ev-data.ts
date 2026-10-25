// Box EV data, built daily by the ev-data workflow and published to the repo's ev-data branch.
// The site reads it from GitHub (EV_DATA_URL points a copy at other data) and keeps it in memory.
import { deckBoxes, type DeckBoxRow, type EvNames, type EvProduct, type EvSummary } from "../shared/ev";
import { nameKey } from "../shared/types";

export const EV_ID = /^[a-z0-9]{2,8}-(play|collector|set|draft)$/;
const TTL = 30 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

export function evDataUrl(): string {
  const u = (process.env.EV_DATA_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : "https://raw.githubusercontent.com/M-Sahin/mtg-master/ev-data/ev";
}

async function get<T>(path: string, fetcher: typeof fetch = fetch): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  try {
    const res = await fetcher(`${evDataUrl()}/${path}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`EV data: ${res.status}`);
    const value = (await res.json()) as T;
    cache.set(path, { at: Date.now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return value;
  } catch (e) {
    if (hit) return hit.value as T; // stale beats nothing
    throw e;
  }
}

export interface EvIndex {
  generatedAt: string;
  source: string;
  products: EvSummary[];
}

export const evIndex = (f?: typeof fetch) => get<EvIndex>("index.json", f);
export const evProduct = (id: string, f?: typeof fetch) => (EV_ID.test(id) ? get<EvProduct>(`p/${id}.json`, f) : Promise.resolve(null));
export const evNames = (f?: typeof fetch) => get<EvNames>("names.json", f);

/** For the deck view: the boxes that could give this deck's cards, best first. */
export async function deckBoxRows(cards: { name: string; price: number | null }[], f?: typeof fetch): Promise<DeckBoxRow[] | null> {
  const names = await evNames(f);
  if (!names) return null;
  return deckBoxes(names, cards, nameKey, 5);
}

export function resetEvCache() {
  cache.clear();
}

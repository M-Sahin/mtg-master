// Share links without a database: the deck itself is compressed into the URL
// (/deck?d=...). Works in browsers and Node (both have CompressionStream).
import type { Deck } from "./types";
import { ROLES, isBasicLand } from "./types";

export const SHARE_VERSION = 1;
export const MAX_PARAM = 8000; // characters of ?d=
const MAX_JSON = 64 * 1024; // bytes after decompression
const MAX_CARDS = 120;

/** Compact form: k = [name, roleIndex, qty?][], e = indexes in k of seed cards. */
export interface SharedPayload {
  v: number;
  n: string; // deck name
  c: string; // commander
  p?: string; // partner
  s?: string; // strategy
  w?: string[]; // win conditions
  b?: string; // bracket notes
  k: [string, number, number?][];
  e?: number[];
  cs?: boolean; // commander is a seed
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Share link is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function toPayload(deck: Deck): SharedPayload {
  const k: [string, number, number?][] = deck.cards.map((c) => {
    const role = Math.max(0, ROLES.indexOf(c.role));
    return c.qty > 1 ? [c.name, role, c.qty] : [c.name, role];
  });
  const e = deck.cards.map((c, i) => (c.seed ? i : -1)).filter((i) => i >= 0);
  return {
    v: SHARE_VERSION,
    n: deck.name.slice(0, 120),
    c: deck.commander.name,
    ...(deck.partner ? { p: deck.partner.name } : {}),
    ...(deck.strategy ? { s: deck.strategy.slice(0, 700) } : {}),
    ...(deck.winConditions.length ? { w: deck.winConditions.slice(0, 8).map((x) => x.slice(0, 160)) } : {}),
    ...(deck.bracketNotes ? { b: deck.bracketNotes.slice(0, 300) } : {}),
    k,
    ...(e.length ? { e } : {}),
    ...(deck.commander.seed ? { cs: true } : {}),
  };
}

export async function encodePayload(p: SharedPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  return toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

export async function encodeDeck(deck: Deck): Promise<string> {
  return encodePayload(toPayload(deck));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Decode and validate a ?d= value. Throws with a readable message on bad input. */
export async function decodePayload(d: string): Promise<SharedPayload> {
  if (!d || d.length > MAX_PARAM || !/^[A-Za-z0-9_-]+$/.test(d)) throw new Error("This share link is broken or incomplete.");
  let raw: any;
  try {
    const json = await pipe(fromBase64Url(d), new DecompressionStream("deflate-raw"), MAX_JSON);
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new Error("This share link is broken or incomplete.");
  }
  if (!raw || raw.v !== SHARE_VERSION || typeof raw.c !== "string" || !Array.isArray(raw.k)) throw new Error("This share link is from a different version of the app.");
  const k: [string, number, number?][] = [];
  for (const item of raw.k.slice(0, MAX_CARDS)) {
    if (!Array.isArray(item) || typeof item[0] !== "string" || !item[0].trim()) continue;
    const name = item[0].trim().slice(0, 150);
    const role = Number.isInteger(item[1]) && item[1] >= 0 && item[1] < ROLES.length ? item[1] : ROLES.indexOf("utility");
    const qty = Number.isInteger(item[2]) && item[2] > 1 ? Math.min(item[2], isBasicLand(name) ? 99 : 99) : undefined;
    k.push(qty ? [name, role, qty] : [name, role]);
  }
  return {
    v: SHARE_VERSION,
    n: str(raw.n, 120) || `${raw.c.slice(0, 80)} deck`,
    c: raw.c.trim().slice(0, 150),
    p: str(raw.p, 150),
    s: str(raw.s, 700),
    w: Array.isArray(raw.w) ? raw.w.filter((x: unknown) => typeof x === "string").slice(0, 8).map((x: string) => x.slice(0, 160)) : undefined,
    b: str(raw.b, 300),
    k,
    e: Array.isArray(raw.e) ? raw.e.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < k.length) : undefined,
    cs: raw.cs === true,
  };
}

/** Short description used in share texts and link previews. */
export function shareTitle(p: { n: string; c: string; p?: string }) {
  return `${p.n}: a Bracket 3 Commander deck led by ${p.c}${p.p ? ` and ${p.p}` : ""}`;
}

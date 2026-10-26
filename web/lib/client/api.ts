"use client";
import type { CardInfo, Color, GenerateRequest, StreamEvent, Usage } from "../shared/types";
import type { PublicConfig } from "../server/config";

export type { PublicConfig };

export async function getConfig(): Promise<PublicConfig> {
  const r = await fetch("/api/config");
  return r.json();
}

export async function autocomplete(q: string, signal?: AbortSignal): Promise<string[]> {
  const r = await fetch(`/api/cards/autocomplete?q=${encodeURIComponent(q)}`, { signal });
  const j = await r.json();
  return j.data ?? [];
}

export async function cardByName(name: string): Promise<CardInfo> {
  const r = await fetch(`/api/cards/named?name=${encodeURIComponent(name)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Card lookup failed");
  return j.card;
}

/** Random Commander-legal card; `id` (e.g. "bg") limits it to that color identity. */
export async function randomCard(kind: "commander" | "card", id = ""): Promise<CardInfo> {
  const r = await fetch(`/api/cards/random?kind=${kind}${id ? `&id=${encodeURIComponent(id)}` : ""}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Random card failed");
  return j.card;
}

async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        try {
          yield JSON.parse(line);
        } catch {}
      }
    }
  }
}

/** Resolves when the page is visible and the browser thinks it's online (phones pause hidden pages). */
function backInFront(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const ready = () => document.visibilityState === "visible" && navigator.onLine !== false;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!ready()) return;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      resolve();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** The build that is running in this tab, so a reload (or a phone discarding the tab) can pick it up again. */
export interface RunningBuild {
  job: string;
  req: GenerateRequest;
  at: number;
}
export const runningBuild = {
  get(): RunningBuild | null {
    try {
      const v = JSON.parse(sessionStorage.getItem("hundredfold:running") ?? "null") as RunningBuild | null;
      return v && Date.now() - v.at < 6 * 60_000 ? v : null;
    } catch {
      return null;
    }
  },
  set(v: RunningBuild | null) {
    try {
      if (v) sessionStorage.setItem("hundredfold:running", JSON.stringify(v));
      else sessionStorage.removeItem("hundredfold:running");
    } catch {}
  },
};

/**
 * Start a build (or, with `resume`, reattach to one) and yield its events. The build runs on the
 * server independently of this connection. Phones leave a connection half-dead after you switch
 * apps, and it can take the browser a long time to notice, so this doesn't wait for that:
 * - coming back to the page after more than a moment drops the old connection and reconnects
 *   right away (the server sends a heartbeat every 5 s, so nothing is lost);
 * - a connection that stays silent for 12 s while the page is visible is treated as dead;
 * - each reconnect continues from the last event seen.
 */
export interface BuildAuth {
  accessCode?: string;
  /** The visitor's own Claude API key; sent with this build only. */
  apiKey?: string;
  model?: string;
}

export async function* generate(req: GenerateRequest, auth: BuildAuth, signal: AbortSignal, resume?: string): AsyncGenerator<StreamEvent> {
  const accessCode = auth.accessCode?.trim() ?? "";
  let job = resume ?? "";
  let next = 0;
  let failures = 0;
  let starting = !resume;
  let attempt: AbortController | null = null;
  let lastLine = Date.now();
  let hiddenAt = 0;
  const hasDoc = typeof document !== "undefined";
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 1500) attempt?.abort(); // don't trust a connection that slept
  };
  if (hasDoc) document.addEventListener("visibilitychange", onVisibility);
  const watchdog = setInterval(() => {
    if ((!hasDoc || document.visibilityState === "visible") && Date.now() - lastLine > 12_000) attempt?.abort();
  }, 2000);
  const stop = () => attempt?.abort();
  signal.addEventListener("abort", stop);
  try {
    for (;;) {
      attempt = new AbortController();
      if (signal.aborted) return;
      lastLine = Date.now();
      let res: Response | null = null;
      try {
        res = starting
          ? await fetch("/api/generate", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(auth.apiKey ? { "x-anthropic-key": auth.apiKey } : accessCode ? { "x-access-code": accessCode } : {}),
              },
              body: JSON.stringify({ ...req, ...(auth.apiKey && auth.model ? { model: auth.model } : {}) }),
              signal: attempt.signal,
            })
          : await fetch(`/api/generate?job=${encodeURIComponent(job)}&from=${next}`, { signal: attempt.signal, cache: "no-store" });
      } catch (e) {
        if (signal.aborted) return;
        if (starting) {
          yield { type: "error", message: `Couldn't reach the server: ${(e as Error).message}` };
          return;
        }
      }
      if (res && !res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          msg = (await res.json()).error ?? msg;
        } catch {}
        if (starting) {
          yield { type: "error", message: msg };
          return;
        }
        if (res.status === 404) {
          runningBuild.set(null);
          yield { type: "error", message: "That build isn't running anymore (the server may have restarted). Try again." };
          return;
        }
        res = null;
      }
      starting = false;
      if (res?.body) {
        try {
          for await (const ev of ndjson(res.body)) {
            lastLine = Date.now();
            failures = 0;
            if (ev.type === "job") {
              job = ev.id;
              runningBuild.set({ job, req, at: Date.now() });
              continue;
            }
            if (typeof ev.i === "number") {
              if (ev.i < next) continue; // already seen before the reconnect
              next = ev.i + 1;
            }
            yield ev as StreamEvent;
            if (ev.type === "done") {
              runningBuild.set(null);
              return;
            }
          }
        } catch {
          /* dropped or aborted by the watchdog: reconnect below */
        }
      }
      if (signal.aborted) return;
      if (!job || ++failures > 12) {
        runningBuild.set(null);
        yield { type: "error", message: "The connection to the build was lost. Try again." };
        return;
      }
      if (failures === 1) yield { type: "status", text: "Reconnecting to the build…" };
      await backInFront();
      if (failures > 1) await sleep(Math.min(1000 * (failures - 1), 4000), signal); // the first retry is immediate
    }
  } finally {
    clearInterval(watchdog);
    signal.removeEventListener("abort", stop);
    if (hasDoc) document.removeEventListener("visibilitychange", onVisibility);
  }
}

/** The "Stop building" button: ask the server to stop, since closing the connection no longer does. */
export async function stopBuild(job: string | undefined): Promise<void> {
  runningBuild.set(null);
  if (!job) return;
  await fetch("/api/generate/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job }), keepalive: true }).catch(() => {});
}

export function storage<T>(key: string) {
  return {
    get(): T | null {
      try {
        const v = localStorage.getItem(key);
        return v ? (JSON.parse(v) as T) : null;
      } catch {
        return null;
      }
    },
    set(v: T | null) {
      try {
        if (v == null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(v));
      } catch {}
    },
  };
}

// ---- own API key -------------------------------------------------------------

/** Check a key with Anthropic (through our server, which doesn't keep it) and list its models. */
export async function checkKey(key: string): Promise<{ id: string; name: string }[]> {
  const r = await fetch("/api/key/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Key check failed (${r.status})`);
  return j.models ?? [];
}

// Browser storage keys keep the name from before the rename to Hundredfoldz, so saved keys,
// decks and settings survive it.
const KEY_NAME = "hundredfold:api-key";
/** Where the key lives: this device (localStorage) or this tab only (sessionStorage). Never on our server. */
export const keyStore = {
  get(): { key: string; remember: boolean } | null {
    try {
      const local = localStorage.getItem(KEY_NAME);
      if (local) return { key: local, remember: true };
      const session = sessionStorage.getItem(KEY_NAME);
      return session ? { key: session, remember: false } : null;
    } catch {
      return null;
    }
  },
  set(key: string, remember: boolean) {
    try {
      localStorage.removeItem(KEY_NAME);
      sessionStorage.removeItem(KEY_NAME);
      (remember ? localStorage : sessionStorage).setItem(KEY_NAME, key);
    } catch {}
  },
  forget() {
    try {
      localStorage.removeItem(KEY_NAME);
      sessionStorage.removeItem(KEY_NAME);
    } catch {}
  },
};

// ---- my decks ------------------------------------------------------------------

/** A deck kept in this browser: the compact share payload plus what the list shows. */
export interface SavedDeck {
  id: string;
  at: number;
  name: string;
  commander: string;
  partner?: string;
  colors: Color[];
  d: string;
  model?: string;
  usage?: Usage;
  /** Saved in the account (d is loaded when opened), not in this browser. */
  cloud?: boolean;
}

const DECKS = "hundredfold:my-decks";
const MAX_DECKS = 30;
export const myDecks = {
  list(): SavedDeck[] {
    try {
      const v = JSON.parse(localStorage.getItem(DECKS) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  },
  add(deck: SavedDeck) {
    const rest = myDecks.list().filter((x) => x.d !== deck.d);
    try {
      localStorage.setItem(DECKS, JSON.stringify([deck, ...rest].slice(0, MAX_DECKS)));
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(DECKS);
    } catch {}
  },
  remove(id: string) {
    try {
      localStorage.setItem(DECKS, JSON.stringify(myDecks.list().filter((x) => x.id !== id)));
    } catch {}
  },
};

/** Rebuild a saved or shared deck with fresh card data. */
export async function resolveDeck(d: string) {
  const r = await fetch("/api/deck/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Couldn't load this deck.");
  return j as { deck: import("../shared/types").Deck; validation: import("../shared/types").Validation };
}

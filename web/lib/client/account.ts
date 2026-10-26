"use client";
// Who's logged in (from /api/auth/session, shared by every component) and the account's decks.
import { useEffect, useState } from "react";
import type { SavedDeck } from "./api";

export interface AccountUser {
  id: string;
  email: string | null;
  name: string;
  provider: string;
}
export interface AccountState {
  loaded: boolean;
  enabled: boolean;
  providers: string[];
  user: AccountUser | null;
}

let state: AccountState = { loaded: false, enabled: false, providers: [], user: null };
let pending: Promise<AccountState> | null = null;
const listeners = new Set<(s: AccountState) => void>();

function set(next: AccountState) {
  state = next;
  for (const l of listeners) l(state);
}

export function loadAccount(force = false): Promise<AccountState> {
  if (pending && !force) return pending;
  pending = fetch("/api/auth/session", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { enabled: false, providers: [], user: null }))
    .catch(() => ({ enabled: false, providers: [], user: null }))
    .then((j) => {
      set({ loaded: true, enabled: !!j.enabled, providers: j.providers ?? [], user: j.user ?? null });
      return state;
    });
  return pending;
}

export function useAccount(): AccountState {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    void loadAccount();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) void loadAccount(true); // session ended: update the navbar
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

export const account = {
  sendLink: (email: string, next: string, turnstile?: string) => call<{ sent: boolean }>("/api/auth/email", { method: "POST", body: JSON.stringify({ email, next, turnstile }) }),
  oauthHref: (provider: string, next: string) => `/api/auth/oauth?provider=${encodeURIComponent(provider)}&next=${encodeURIComponent(next)}`,
  async logout() {
    await call("/api/auth/logout", { method: "POST", body: "{}" });
    await loadAccount(true);
  },
  async deleteAccount() {
    await call("/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: "delete" }) });
    await loadAccount(true);
  },
};

/** The account's decks, in the same shape as decks kept in the browser (d is fetched when opened). */
export const cloudDecks = {
  async list(): Promise<SavedDeck[]> {
    const j = await call<{ decks: (Omit<SavedDeck, "d" | "colors"> & { colors: string[] })[] }>("/api/decks");
    return j.decks.map((d) => ({ ...d, colors: d.colors as SavedDeck["colors"], d: "", cloud: true }));
  },
  async payload(id: string): Promise<string> {
    const j = await call<{ deck: { d: string } }>(`/api/decks/${encodeURIComponent(id)}`);
    return j.deck.d;
  },
  save(deck: SavedDeck) {
    return call<{ saved: unknown[]; duplicates: number }>("/api/decks", { method: "POST", body: JSON.stringify({ d: deck.d, colors: deck.colors, model: deck.model, usage: deck.usage }) });
  },
  importMany(decks: SavedDeck[]) {
    return call<{ saved: unknown[]; duplicates: number; skipped: number }>("/api/decks", { method: "POST", body: JSON.stringify({ decks: decks.map((d) => ({ d: d.d, colors: d.colors, model: d.model, usage: d.usage })) }) });
  },
  rename: (id: string, name: string) => call(`/api/decks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  remove: (id: string) => call(`/api/decks/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** The current page, to come back to after logging in. */
export const herePath = () => (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.hash}`);

"use client";
import type { CardInfo, GenerateRequest, StreamEvent } from "../shared/types";
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

/** POST /api/generate and yield NDJSON events as they arrive. */
export async function* generate(req: GenerateRequest, accessCode: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", ...(accessCode ? { "x-access-code": accessCode } : {}) },
    body: JSON.stringify(req),
    signal,
  });
  if (!r.ok || !r.body) {
    let msg = `Request failed (${r.status})`;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {}
    yield { type: "error", message: msg };
    return;
  }
  const reader = r.body.getReader();
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
          yield JSON.parse(line) as StreamEvent;
        } catch {}
      }
    }
  }
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

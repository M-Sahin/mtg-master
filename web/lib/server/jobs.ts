// Builds run as jobs that don't depend on the browser's connection. Phones pause or drop
// connections when you switch apps; the build keeps going and the page reconnects with
// GET /api/generate?job=<id>&from=<n> to read the events it missed.
//
// Events live in memory (enough for one server: Docker, Node, and usually Vercel too, which
// tends to route the reconnect to the same instance) and, when the Upstash store is set up
// (lib/server/store.ts), also in Redis, so any instance can serve the reconnect.
import type { StreamEvent } from "../shared/types";
import { kv, kvConfig } from "./store";

const JOB_TTL_S = 15 * 60;
const FLUSH_MS = 1500; // batches events: ~120 store commands per build (Upstash free tier: 500K/month)
const key = (id: string) => `hf:job:${id}`;
const stopKey = (id: string) => `hf:job:${id}:stop`;
export const JOB_ID = /^[0-9a-f]{32}$/;

interface Job {
  events: StreamEvent[];
  done: boolean;
  wake: Set<() => void>;
  abort: AbortController;
  at: number;
}

const jobs = new Map<string, Job>();

function prune(now = Date.now()) {
  for (const [id, j] of jobs) if (now - j.at > JOB_TTL_S * 1000) jobs.delete(id);
}

export function newJobId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Start a job. `run` gets an emit function and an abort signal; the returned promise
 * resolves when the job is finished and every event is stored.
 */
export function startJob(id: string, run: (emit: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>): Promise<void> {
  prune();
  const job: Job = { events: [], done: false, wake: new Set(), abort: new AbortController(), at: Date.now() };
  jobs.set(id, job);
  const store = kvConfig();
  let pending: string[] = [];
  let flushing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let expirySet = false;
  const flush = () => {
    timer = null;
    if (!store || !pending.length) return flushing;
    const batch = pending;
    pending = [];
    // keep the order: each flush waits for the previous one
    const first = !expirySet;
    expirySet = true;
    flushing = flushing
      .then(() => kv(["RPUSH", key(id), ...batch]))
      .then(() => (first || job.done ? kv(["EXPIRE", key(id), JOB_TTL_S]) : undefined))
      .then(() => undefined)
      .catch(() => undefined);
    return flushing;
  };
  const emit = (e: StreamEvent) => {
    job.events.push(e);
    for (const w of job.wake) w();
    if (store) {
      pending.push(JSON.stringify(e));
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    }
  };
  // a stop request can arrive at another instance: it sets a flag in the store
  const poll = store
    ? setInterval(() => {
        kv(["GET", stopKey(id)])
          .then((v) => v && job.abort.abort())
          .catch(() => {});
      }, 6000)
    : null;
  return (async () => {
    try {
      await run(emit, job.abort.signal);
    } catch (e) {
      emit({ type: "error", message: (e as Error).message || "Something went wrong." });
    } finally {
      if (poll) clearInterval(poll);
      job.done = true;
      if (timer) clearTimeout(timer);
      for (const w of job.wake) w();
      await flush();
    }
  })();
}

/** Is this build known here or in the store? (Events reach the store within a second of starting.) */
export async function jobExists(id: string): Promise<boolean> {
  if (jobs.has(id)) return true;
  if (!kvConfig()) return false;
  for (let k = 0; k < 3; k++) {
    if (Number(await kv(["EXISTS", key(id)]).catch(() => 0)) > 0) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

export async function stopJob(id: string): Promise<void> {
  jobs.get(id)?.abort.abort();
  if (kvConfig()) await kv(["SET", stopKey(id), "1", "EX", JOB_TTL_S]).catch(() => {});
}

export type Tail = AsyncGenerator<{ i: number; event: StreamEvent }>;

/** Events of a job from index `from` on, as they arrive, until the job is done. */
export async function* tailJob(id: string, from: number, signal?: AbortSignal): Tail {
  let i = Math.max(0, from);
  const local = jobs.get(id);
  if (local) {
    for (;;) {
      while (i < local.events.length) {
        yield { i, event: local.events[i] };
        i++;
      }
      if (local.done || signal?.aborted) return;
      await new Promise<void>((resolve) => {
        const wake = () => {
          local.wake.delete(wake);
          resolve();
        };
        local.wake.add(wake);
        signal?.addEventListener("abort", wake, { once: true });
      });
    }
  }
  if (!kvConfig()) throw new JobNotFound();
  // another instance runs it: poll the store
  let missing = 0;
  const started = Date.now();
  while (!signal?.aborted && Date.now() - started < 320_000) {
    const raw = (await kv(["LRANGE", key(id), i, -1]).catch(() => null)) as string[] | null;
    if (raw && raw.length) {
      missing = 0;
      for (const r of raw) {
        let event: StreamEvent;
        try {
          event = JSON.parse(r);
        } catch {
          i++;
          continue;
        }
        yield { i, event };
        i++;
        if (event.type === "done") return;
      }
    } else if (i === 0 && ++missing > 8) throw new JobNotFound();
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export class JobNotFound extends Error {
  constructor() {
    super("This build isn't running anymore.");
  }
}

/** For tests. */
export function _jobs() {
  return jobs;
}

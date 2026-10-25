// Builds survive the browser going away: reconnect, stop, and the cross-instance store path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SEEDS } from "../lib/server/demo";
import { handleGenerate, handleResume, handleStop } from "../lib/server/generate-handler";
import { _jobs, startJob, tailJob } from "../lib/server/jobs";
import type { StreamEvent } from "../lib/shared/types";
import { installFakeScryfall } from "./fixtures";

async function* lines(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (l) yield JSON.parse(l);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const start = () => new Request("http://x/api/generate", { method: "POST", body: JSON.stringify({ seeds: DEMO_SEEDS, commander: null, budget: "any" }) });

test("the build keeps running when the browser disconnects, and a reconnect gets the rest", async () => {
  const fake = installFakeScryfall();
  delete process.env.ANTHROPIC_API_KEY;
  try {
    let running: Promise<unknown> | undefined;
    const res = await handleGenerate(start(), { demoSpeed: 0.02, waitUntil: (p) => (running = p) });
    let job = "";
    let last = -1;
    for await (const ev of lines(res)) {
      if (ev.type === "job") job = ev.id;
      if (typeof ev.i === "number") last = ev.i;
      if (last >= 3) break; // the phone switches apps: the stream is dropped mid-build
    }
    assert.match(job, /^[0-9a-f]{32}$/);
    assert.ok(running, "the build was handed to waitUntil");
    await running; // finishes without anyone listening
    const again = await handleResume(new Request(`http://x/api/generate?job=${job}&from=${last + 1}`));
    assert.equal(again.status, 200);
    const rest: any[] = [];
    for await (const ev of lines(again)) if (ev.type !== "status" || ev.text) rest.push(ev);
    assert.equal(rest[0].i, last + 1, "continues exactly where it stopped");
    const deck = rest.find((e) => e.type === "deck");
    assert.ok(deck?.validation.ok, "the deck arrives after the reconnect");
    assert.equal(rest.at(-1).type, "done");
  } finally {
    fake.restore();
  }
});

test("reconnecting to an unknown build is a 404; bad ids are rejected", async () => {
  const r = await handleResume(new Request(`http://x/api/generate?job=${"0".repeat(32)}&from=0`));
  assert.equal(r.status, 404);
  assert.equal((await handleResume(new Request("http://x/api/generate?job=nope"))).status, 400);
  assert.equal((await handleStop(new Request("http://x/api/generate/stop", { method: "POST", body: "{}" }))).status, 400);
});

test("Stop building stops the job on the server", async () => {
  const id = "a".repeat(32);
  let sawAbort = false;
  const done = startJob(id, async (emit, signal) => {
    emit({ type: "status", text: "working" });
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    sawAbort = true;
    emit({ type: "done", ms: 1 });
  });
  const r = await handleStop(new Request("http://x/api/generate/stop", { method: "POST", body: JSON.stringify({ job: id }) }));
  assert.equal(r.status, 200);
  await done;
  assert.ok(sawAbort);
  const seen: StreamEvent[] = [];
  for await (const { event } of tailJob(id, 0)) seen.push(event);
  assert.deepEqual(seen.map((e) => e.type), ["status", "done"]);
});

test("with the store configured, another server instance can serve the reconnect", async () => {
  const data = new Map<string, string[]>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith("https://kv.example")) return original(input, init);
    const [op, key, ...args] = JSON.parse(init.body);
    let result: unknown = null;
    if (op === "RPUSH") {
      data.set(key, [...(data.get(key) ?? []), ...args]);
      result = data.get(key)!.length;
    } else if (op === "LRANGE") {
      const list = data.get(key) ?? [];
      result = list.slice(Number(args[0]), Number(args[1]) === -1 ? undefined : Number(args[1]) + 1);
    } else if (op === "EXISTS") result = data.has(key) ? 1 : 0;
    else if (op === "EXPIRE") result = 1;
    else if (op === "GET") result = null;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;
  process.env.KV_REST_API_URL = "https://kv.example";
  process.env.KV_REST_API_TOKEN = "tok";
  try {
    const id = "b".repeat(32);
    await startJob(id, async (emit) => {
      emit({ type: "status", text: "one" });
      emit({ type: "text", delta: "two" });
      emit({ type: "done", ms: 5 });
    });
    assert.equal(data.get(`hf:job:${id}`)?.length, 3, "events reached the store in one batch");
    _jobs().delete(id); // this instance never saw the build
    const seen: { i: number; event: StreamEvent }[] = [];
    for await (const x of tailJob(id, 1)) seen.push(x);
    assert.deepEqual(seen.map((x) => [x.i, x.event.type]), [[1, "text"], [2, "done"]]);
    const res = await handleResume(new Request(`http://x/api/generate?job=${id}&from=0`));
    assert.equal(res.status, 200);
  } finally {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    globalThis.fetch = original;
  }
});

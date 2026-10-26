// The shared rate limiter: counts in Upstash when it's there (one count for all instances),
// never stores raw IPs or emails, falls back to per-instance counting, and answers 429s properly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, guard, rateLimit, rateLimitAll, resetRateLimits, tooMany } from "../lib/server/ratelimit";

function withKv<T>(fn: () => Promise<T>): Promise<T> {
  const keep = { ...process.env };
  Object.assign(process.env, { KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "tok" });
  return fn().finally(() => {
    process.env = keep;
  });
}

test("with a store: one shared INCR per request, hashed keys, an expiry", () =>
  withKv(async () => {
    const counts = new Map<string, number>();
    const bodies: any[] = [];
    const f = (async (url: string, init: RequestInit) => {
      assert.equal(url, "https://kv.example/pipeline");
      assert.equal((init.headers as any).authorization, "Bearer tok");
      const cmds = JSON.parse(String(init.body));
      bodies.push(cmds);
      const k = cmds[0][1];
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return Response.json([{ result: counts.get(k) }, { result: 1 }]);
    }) as unknown as typeof fetch;
    const rule = { kind: "email", max: 2 };
    const now = 1_800_000_000_000;
    assert.equal((await rateLimit(rule, "player@example.com", { fetch: f, now })).ok, true);
    assert.equal((await rateLimit(rule, "player@example.com", { fetch: f, now })).ok, true);
    const third = await rateLimit(rule, "player@example.com", { fetch: f, now: now + 5000 });
    assert.equal(third.ok, false);
    assert.equal(third.retryAfter, 3595);
    const [incr, expire] = bodies[0];
    assert.equal(incr[0], "INCR");
    assert.match(incr[1], /^hf:rl:email:\d+:[0-9a-f]{24}$/);
    assert.ok(!JSON.stringify(bodies).includes("player"), "no email in the store");
    assert.deepEqual(expire, ["EXPIRE", incr[1], 3660]);
  }));

test("store down: still limited, per instance", () =>
  withKv(async () => {
    resetRateLimits();
    const f = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const rule = { kind: "down", max: 1 };
    assert.equal((await rateLimit(rule, "9.9.9.9", { fetch: f })).ok, true);
    assert.equal((await rateLimit(rule, "9.9.9.9", { fetch: f })).ok, false);
  }));

test("several limits: the first one over wins; 429s carry Retry-After", async () => {
  resetRateLimits();
  const ip = { kind: "multi-ip", max: 5 };
  const email = { kind: "multi-email", max: 1 };
  assert.equal((await rateLimitAll([[ip, "1.1.1.1"], [email, "a@b.co"]])).ok, true);
  const r = await rateLimitAll([[ip, "1.1.1.1"], [email, "a@b.co"]]);
  assert.equal(r.ok, false);
  const res = tooMany("Slow down.", r);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
  assert.deepEqual(await res.json(), { error: "Slow down." });
});

test("client address: Vercel's header first, IPv6 counted per /64", async () => {
  const keep = { ...process.env };
  try {
    process.env.VERCEL = "1";
    const r = new Request("https://x.example", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 203.0.113.7" } });
    assert.equal(clientIp(r), "203.0.113.7");
    delete process.env.VERCEL;
    assert.equal(clientIp(new Request("https://x.example", { headers: { "x-forwarded-for": "198.51.100.2, 10.0.0.1" } })), "198.51.100.2");
    assert.equal(clientIp(new Request("https://x.example", { headers: { "x-forwarded-for": "2001:db8:aa:bb:1:2:3:4" } })), "2001:db8:aa:bb::/64");
    // two addresses in one /64 share a limit
    resetRateLimits();
    const rule = { kind: "v6", max: 1 };
    const a = new Request("https://x.example", { headers: { "x-forwarded-for": "2001:db8:aa:bb::1" } });
    const b = new Request("https://x.example", { headers: { "x-forwarded-for": "2001:db8:aa:bb::2" } });
    assert.equal(await guard(a, rule), null);
    assert.equal((await guard(b, rule))?.status, 429);
  } finally {
    process.env = keep;
  }
});

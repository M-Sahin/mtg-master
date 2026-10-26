// Free builds: off by default, a few per visitor on the free model, counted per browser, account,
// address and day; failed builds are given back; stronger models need the visitor's own key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimFreeBuild, freeConfig, freeStatus, resetFreeBuilds, visitor, type FreeConfig } from "../lib/server/free-builds";
import { handleFreeStatus, handleGenerate } from "../lib/server/generate-handler";
import { publicConfig } from "../lib/server/config";
import { resetRateLimits } from "../lib/server/ratelimit";
import { installFakeScryfall } from "./fixtures";

const cfg: FreeConfig = { perVisitor: 3, perIpPerDay: 5, perDay: 8, model: "claude-haiku-5-5", effort: "high" };
const req = (cookie = "", ip = "1.2.3.4") => new Request("http://x/api/generate", { method: "POST", headers: { cookie, "x-forwarded-for": ip } });

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const keep = { ...process.env };
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DEMO_MODE", "ACCESS_CODE", "PUBLIC_ACCESS", "OWN_KEYS", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) delete process.env[k];
  Object.assign(process.env, env);
  resetFreeBuilds();
  resetRateLimits();
  try {
    return await fn();
  } finally {
    process.env = keep;
  }
}

test("off unless the site has a key and FREE_BUILDS", () =>
  withEnv({}, async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.FREE_BUILDS = "3";
    assert.equal(freeConfig(), null);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.FREE_BUILDS;
    assert.equal(freeConfig(), null);
    process.env.FREE_BUILDS = "3";
    const c = freeConfig()!;
    assert.equal(c.perVisitor, 3);
    assert.equal(c.model, "claude-haiku-5-5");
    assert.equal(c.effort, "high");
    // the site config tells the browser, and own keys are on without OWN_KEYS
    const p = publicConfig();
    assert.deepEqual(p.freeBuilds, { limit: 3, model: "claude-haiku-5-5", modelLabel: "Claude Haiku 5.5" });
    assert.equal(p.ownKeys, true);
    assert.equal(p.setupProblem, null, "no access code needed");
    assert.equal(p.accessCodeRequired, false);
  }));

test("a new browser gets an id cookie; the same cookie is the same visitor", () => {
  const a = visitor(req());
  assert.match(a.setCookie ?? "", /^hf_dev=[\w-]{22,}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
  const b = visitor(req(`hf_dev=${a.device}`));
  assert.equal(b.device, a.device);
  assert.equal(b.setCookie, null);
  assert.equal(visitor(req("hf_dev=../bad")).setCookie !== null, true, "junk ids are replaced");
});

test("three per visitor, then refused; a failed build is given back", () =>
  withEnv({}, async () => {
    const v = visitor(req("hf_dev=" + "a".repeat(24)));
    assert.equal((await freeStatus(cfg, v)).remaining, 3);
    const first = await claimFreeBuild(cfg, v);
    assert.ok(first.ok && first.remaining === 2);
    await claimFreeBuild(cfg, v);
    const third = await claimFreeBuild(cfg, v);
    assert.ok(third.ok && third.remaining === 0);
    assert.deepEqual(await claimFreeBuild(cfg, v), { ok: false, reason: "used" });
    assert.equal((await freeStatus(cfg, v)).remaining, 0);
    // the third one failed on our side: it doesn't count
    if (third.ok) await third.refund();
    if (third.ok) await third.refund(); // only once
    assert.equal((await freeStatus(cfg, v)).remaining, 1);
    // a refused claim didn't use anything either
    assert.ok((await claimFreeBuild(cfg, v)).ok);
  }));

test("logging in doesn't reset the count, and new cookies run into the address limit", () =>
  withEnv({}, async () => {
    const user = (id: string) => `hf_at=${["x", Buffer.from(JSON.stringify({ sub: id, exp: 9e9, role: "authenticated" })).toString("base64url"), "y"].join(".")}`;
    const phone = visitor(req(`hf_dev=${"p".repeat(24)}; ${user("u1")}`, "9.9.9.9"));
    for (let i = 0; i < 3; i++) assert.ok((await claimFreeBuild(cfg, phone)).ok);
    // same account on a laptop with a fresh browser id
    const laptop = visitor(req(`hf_dev=${"l".repeat(24)}; ${user("u1")}`, "8.8.8.8"));
    assert.deepEqual(await claimFreeBuild(cfg, laptop), { ok: false, reason: "used" });
    // one address clearing cookies: 5 a day
    for (let i = 0; i < 5; i++) assert.ok((await claimFreeBuild(cfg, visitor(req(`hf_dev=${String(i).repeat(24)}`, "7.7.7.7")))).ok);
    assert.deepEqual(await claimFreeBuild(cfg, visitor(req(`hf_dev=${"z".repeat(24)}`, "7.7.7.7"))), { ok: false, reason: "ip" });
    // and the whole site: 8 a day (3 + 5 so far)
    const other = visitor(req(`hf_dev=${"o".repeat(24)}`, "6.6.6.6"));
    assert.deepEqual(await claimFreeBuild(cfg, other), { ok: false, reason: "site" });
    assert.deepEqual(await freeStatus(cfg, other), { limit: 3, used: 0, remaining: 0, model: "claude-haiku-5-5", blocked: "site" });
  }));

test("counts live in the shared store, hashed, with expiry set once", () =>
  withEnv({ KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" }, async () => {
    const sent: unknown[][] = [];
    const counts = new Map<string, number>();
    const f = (async (_url: string, init: RequestInit) => {
      const cmds = JSON.parse(String(init.body)) as (string | number)[][];
      sent.push(...cmds);
      return Response.json(
        cmds.map(([op, k]) => {
          const key = String(k);
          if (op === "INCR") counts.set(key, (counts.get(key) ?? 0) + 1);
          if (op === "DECR") counts.set(key, (counts.get(key) ?? 0) - 1);
          return { result: op === "EXPIRE" ? 1 : (counts.get(key) ?? null) };
        }),
      );
    }) as unknown as typeof fetch;
    const v = visitor(req(`hf_dev=${"s".repeat(24)}`));
    const c = await claimFreeBuild(cfg, v, { fetch: f });
    assert.ok(c.ok);
    const text = JSON.stringify(sent);
    assert.ok(!text.includes("s".repeat(24)) && !text.includes("1.2.3.4"), "no raw ids or addresses");
    assert.ok(sent.some(([op, , ttl, nx]) => op === "EXPIRE" && ttl === 31536000 && nx === "NX"));
    assert.equal((await freeStatus(cfg, v, { fetch: f })).remaining, 2);
  }));

test("a free build runs on the free model with high effort, whatever model is asked for", () =>
  withEnv({ ANTHROPIC_API_KEY: "sk-ant-site-" + "k".repeat(30), FREE_BUILDS: "3" }, async () => {
    const fake = installFakeScryfall();
    const original = globalThis.fetch;
    const seen: { model?: string; effort?: string; key?: string } = {};
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).startsWith("https://api.anthropic.com/v1/messages")) {
        const b = JSON.parse(init.body);
        Object.assign(seen, { model: b.model, effort: b.output_config?.effort, key: init.headers["x-api-key"] });
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad request" } }), { status: 400 });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const body = JSON.stringify({ seeds: ["Sol Ring", "Viscera Seer", "Grim Haruspex", "Eternal Witness", "Meren of Clan Nel Toth"], commander: null, budget: "any", model: "claude-opus-5-5" });
      let after: Promise<unknown> | undefined;
      const res = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { "x-forwarded-for": "5.5.5.5" }, body }), { waitUntil: (p) => (after = p) });
      assert.equal(res.status, 200);
      const cookie = res.headers.get("set-cookie") ?? "";
      assert.match(cookie, /^hf_dev=/, "a new browser gets its id with the build");
      await res.text();
      await after;
      assert.deepEqual(seen, { model: "claude-haiku-5-5", effort: "high", key: process.env.ANTHROPIC_API_KEY });
      // the build failed on Claude's side, so it was given back
      const status = await (await handleFreeStatus(new Request("http://x/api/free-builds", { headers: { cookie: cookie.split(";")[0], "x-forwarded-for": "5.5.5.5" } }))).json();
      assert.equal(status.remaining, 3);
    } finally {
      globalThis.fetch = original;
      fake.restore();
    }
  }));

test("with none left: 402 and a code the page can act on; the bot check comes first", () =>
  withEnv({ ANTHROPIC_API_KEY: "sk-test", FREE_BUILDS: "1" }, async () => {
    const body = JSON.stringify({ seeds: ["a", "b", "c", "d", "e"], commander: null, budget: "any" });
    const one = { perVisitor: 1, perIpPerDay: 10, perDay: 300, model: "claude-haiku-5-5", effort: "high" };
    await claimFreeBuild(one, visitor(req(`hf_dev=${"q".repeat(24)}`)));
    const res = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { cookie: `hf_dev=${"q".repeat(24)}`, "x-forwarded-for": "1.2.3.4" }, body }));
    assert.equal(res.status, 402);
    const j = await res.json();
    assert.equal(j.code, "free_used");
    assert.match(j.error, /used your free build\. Add your own Claude API key/);
    process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    const bot = await handleGenerate(new Request("http://x/api/generate", { method: "POST", headers: { "x-forwarded-for": "2.2.2.2" }, body }));
    assert.equal(bot.status, 403);
  }));

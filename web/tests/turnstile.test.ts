// The Turnstile bot check: off without keys, verified once with Cloudflare, tokens for one form
// don't open another, login tokens go to Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTurnstile } from "../lib/server/turnstile";
import { handleBracketCheck } from "../lib/server/bracket-check";
import { handleEmail } from "../lib/server/account-handler";
import { resetRateLimits } from "../lib/server/ratelimit";

async function withKeys<T>(fn: () => Promise<T>): Promise<T> {
  const keep = { ...process.env };
  Object.assign(process.env, { TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" });
  try {
    return await fn();
  } finally {
    process.env = keep;
  }
}

const cloudflare = (answer: Record<string, unknown>, seen: URLSearchParams[] = []) =>
  (async (url: string, init: RequestInit) => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    seen.push(new URLSearchParams(String(init.body)));
    return Response.json(answer);
  }) as unknown as typeof fetch;

test("off without keys: everything passes", async () => {
  const keep = { ...process.env };
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    assert.deepEqual(await verifyTurnstile(undefined, "1.2.3.4"), { ok: true });
  } finally {
    process.env = keep;
  }
});

test("with keys: the token is checked with Cloudflare, with the secret and the visitor's IP", () =>
  withKeys(async () => {
    const seen: URLSearchParams[] = [];
    assert.deepEqual(await verifyTurnstile("tok", "203.0.113.9", "bracket", cloudflare({ success: true, action: "bracket" }, seen)), { ok: true });
    assert.equal(seen[0].get("secret"), "1x0000000000000000000000000000000AA");
    assert.equal(seen[0].get("response"), "tok");
    assert.equal(seen[0].get("remoteip"), "203.0.113.9");
    assert.equal((await verifyTurnstile(undefined, "1.1.1.1", "bracket")).reason, "missing");
    assert.equal((await verifyTurnstile("tok", "1.1.1.1", "bracket", cloudflare({ success: false }))).reason, "invalid");
    assert.equal((await verifyTurnstile("tok", "1.1.1.1", "bracket", cloudflare({ success: true, action: "login" }))).ok, false, "a login token doesn't open the bracket checker");
    const down = (async () => {
      throw new Error("unreachable");
    }) as unknown as typeof fetch;
    assert.equal((await verifyTurnstile("tok", "1.1.1.1", "bracket", down)).ok, true, "Cloudflare down: let people through, the rate limits still apply");
  }));

test("the bracket checker refuses requests without a token when the check is on", () =>
  withKeys(async () => {
    resetRateLimits();
    const res = await handleBracketCheck(new Request("http://x/api/bracket", { method: "POST", headers: { "x-forwarded-for": "198.51.100.77" }, body: JSON.stringify({ list: "1 Sol Ring" }) }));
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /not a bot/);
  }));

test("login emails pass the token on to Supabase, which verifies it", async () => {
  resetRateLimits();
  let sent: any = null;
  const f = (async (url: string, init: RequestInit) => {
    if (String(url).includes("/auth/v1/otp")) sent = JSON.parse(String(init.body));
    return Response.json({});
  }) as unknown as typeof fetch;
  const keep = { ...process.env };
  process.env.SITE_URL = "https://hundredfoldz.example";
  try {
    const req = new Request("https://hundredfoldz.example/api/auth/email", { method: "POST", headers: { origin: "https://hundredfoldz.example", host: "hundredfoldz.example", "x-forwarded-for": "198.51.100.78" }, body: JSON.stringify({ email: "p@example.com", turnstile: "cf-token" }) });
    const res = await handleEmail(req, { config: { url: "https://proj.supabase.co", anonKey: "k" }, fetch: f });
    assert.equal(res.status, 200);
    assert.deepEqual(sent.gotrue_meta_security, { captcha_token: "cf-token" });
  } finally {
    process.env = keep;
  }
});

// Accounts: PKCE logins, cookie sessions, and the deck API, against a fake Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCallback, handleDeck, handleDecks, handleDeleteAccount, handleEmail, handleOAuth, handleSession, resetLimits } from "../lib/server/account-handler";
import { pkceChallenge, requestAuth, resetProviderCache, safeNext, supabaseConfig, tokenUser } from "../lib/server/supabase";
import { encodeDeck } from "../lib/shared/share";
import type { Deck } from "../lib/shared/types";

const cfg = { url: "https://proj.supabase.co", anonKey: "anon-key" };
const SITE = "https://hundredfoldz.example";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64({ role: "authenticated", ...claims })}.sig`;
const fresh = (sub = "u1") => jwt({ sub, email: `${sub}@example.com`, exp: Math.floor(Date.now() / 1000) + 3600, user_metadata: { full_name: "Murat" }, app_metadata: { provider: "discord" } });
const stale = (sub = "u1") => jwt({ sub, exp: Math.floor(Date.now() / 1000) - 10 });

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function fakeSupabase(routes: (c: Call) => { status?: number; body?: unknown } | undefined) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c: Call = { url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])), body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const r = routes(c) ?? { status: 404, body: { message: "not found" } };
    const status = r.status ?? 200;
    return new Response(status === 204 || r.body === undefined ? null : JSON.stringify(r.body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function req(path: string, init: { method?: string; cookies?: Record<string, string>; body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: "hundredfoldz.example", "x-forwarded-proto": "https" };
  if (init.cookies) headers.cookie = Object.entries(init.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  if (init.origin !== null && init.method && init.method !== "GET") headers.origin = init.origin ?? SITE;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${SITE}${path}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const setCookies = (r: Response) => r.headers.getSetCookie();
const cookieVal = (r: Response, name: string) => {
  const c = setCookies(r).find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.split(";")[0].slice(name.length + 1)) : undefined;
};

test("config: off without settings; plain http only for a local Supabase", () => {
  const keep = { ...process.env };
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.equal(supabaseConfig(), null);
    Object.assign(process.env, { SUPABASE_URL: "http://evil.example", SUPABASE_ANON_KEY: "k" });
    assert.equal(supabaseConfig(), null);
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    assert.deepEqual(supabaseConfig(), { url: "http://127.0.0.1:54321", anonKey: "k" });
    process.env.SUPABASE_URL = "https://proj.supabase.co/";
    assert.equal(supabaseConfig()?.url, "https://proj.supabase.co");
  } finally {
    process.env = keep;
  }
});

test("PKCE challenge matches RFC 7636, and next paths can't leave the site", async () => {
  assert.equal(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(safeNext("/#my-decks"), "/#my-decks");
  assert.equal(safeNext("/account?x=1"), "/account?x=1");
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", ""]) assert.equal(safeNext(bad), "/", bad);
});

test("session: providers from Supabase, the user from the token without a network call", async () => {
  resetProviderCache();
  const { f, calls } = fakeSupabase((c) => (c.url.endsWith("/auth/v1/settings") ? { body: { external: { email: true, discord: true, google: false } } } : undefined));
  const out = await (await handleSession(req("/api/auth/session"), { config: cfg, fetch: f })).json();
  assert.deepEqual(out, { enabled: true, providers: ["email", "discord"], user: null });
  const me = await (await handleSession(req("/api/auth/session", { cookies: { hf_at: fresh() } }), { config: cfg, fetch: f })).json();
  assert.deepEqual(me.user, { id: "u1", email: "u1@example.com", name: "Murat", provider: "discord" });
  assert.equal(calls.filter((c) => c.url.includes("/auth/v1/user") || c.url.includes("token")).length, 0);
  assert.equal(tokenUser(jwt({ sub: "x", exp: 1, role: "anon" })), null, "anon tokens aren't users");
  const off = await (await handleSession(req("/api/auth/session"), { config: null })).json();
  assert.equal(off.enabled, false);
});

test("an expiring session is refreshed; a dead refresh token logs out", async () => {
  const { f, calls } = fakeSupabase((c) => {
    if (c.url.includes("grant_type=refresh_token")) return c.body.refresh_token === "good" ? { body: { access_token: fresh("u2"), refresh_token: "next", expires_in: 3600, user: { id: "u2" } } } : { status: 400, body: { msg: "Invalid Refresh Token" } };
  });
  const r = await requestAuth(req("/", { cookies: { hf_at: stale(), hf_rt: "good" } }), cfg, f);
  assert.equal(r.user?.id, "u2");
  assert.ok(r.setCookies.some((c) => c.startsWith("hf_rt=next;") && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c)));
  const dead = await requestAuth(req("/", { cookies: { hf_at: stale(), hf_rt: "bad" } }), cfg, f);
  assert.equal(dead.user, null);
  assert.ok(dead.setCookies.some((c) => /^hf_at=;.*Max-Age=0/.test(c)));
  assert.equal(calls.length, 2);
});

test("magic link: PKCE challenge and the callback URL go to Supabase; the verifier stays in a cookie", async () => {
  resetLimits();
  const { f, calls } = fakeSupabase((c) => (c.url.includes("/auth/v1/otp") ? { body: {} } : undefined));
  const res = await handleEmail(req("/api/auth/email", { method: "POST", body: { email: "Player@Example.com", next: "/#my-decks" } }), { config: cfg, fetch: f });
  assert.equal(res.status, 200);
  const call = calls[0];
  assert.equal(new URL(call.url).searchParams.get("redirect_to"), `${SITE}/auth/callback`);
  assert.equal(call.body.email, "player@example.com");
  const verifier = cookieVal(res, "hf_pkce")!;
  assert.equal(call.body.code_challenge, await pkceChallenge(verifier));
  assert.equal(cookieVal(res, "hf_next"), "/#my-decks");
  // from another site: refused
  assert.equal((await handleEmail(req("/api/auth/email", { method: "POST", body: { email: "a@b.co" }, origin: "https://evil.example" }), { config: cfg, fetch: f })).status, 403);
  assert.equal((await handleEmail(req("/api/auth/email", { method: "POST", body: { email: "nope" } }), { config: cfg, fetch: f })).status, 400);
  // the same address over and over: limited
  let last = 0;
  for (let i = 0; i < 4; i++) last = (await handleEmail(req("/api/auth/email", { method: "POST", body: { email: "spam@example.com" } }), { config: cfg, fetch: f })).status;
  assert.equal(last, 429);
});

test("Discord login: off to Supabase with a challenge; the callback signs in and returns to the page", async () => {
  const res = await handleOAuth(req("/api/auth/oauth?provider=discord&next=/ev"), { config: cfg });
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.origin + to.pathname, "https://proj.supabase.co/auth/v1/authorize");
  assert.equal(to.searchParams.get("provider"), "discord");
  assert.equal(to.searchParams.get("code_challenge_method"), "s256");
  const verifier = cookieVal(res, "hf_pkce")!;
  assert.equal(to.searchParams.get("code_challenge"), await pkceChallenge(verifier));
  assert.equal((await handleOAuth(req("/api/auth/oauth?provider=github"), { config: cfg })).status, 400);

  const { f, calls } = fakeSupabase((c) => (c.url.includes("grant_type=pkce") && c.body.auth_code === "abc" && c.body.code_verifier === verifier ? { body: { access_token: fresh(), refresh_token: "rt", expires_in: 3600, user: { id: "u1" } } } : { status: 400, body: { msg: "bad code" } }));
  const back = await handleCallback(req("/auth/callback?code=abc", { cookies: { hf_pkce: verifier, hf_next: "/ev" } }), { config: cfg, fetch: f });
  assert.equal(back.headers.get("location"), "/ev");
  assert.ok(cookieVal(back, "hf_at"));
  assert.equal(cookieVal(back, "hf_rt"), "rt");
  assert.equal(calls.length, 1);
  // a magic link opened in another browser has no verifier
  const other = await handleCallback(req("/auth/callback?code=abc"), { config: cfg, fetch: f });
  assert.equal(other.headers.get("location"), "/account?login=other-browser");
  const expired = await handleCallback(req("/auth/callback?error=access_denied&error_description=Email+link+is+invalid+or+has+expired", { cookies: { hf_pkce: verifier } }), { config: cfg, fetch: f });
  assert.equal(expired.headers.get("location"), "/account?login=expired");
});

const deck = {
  name: "Meren's Harvest", strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"], bracket: 3,
  commander: { name: "Meren of Clan Nel Toth", role: "wincon", why: "", qty: 1 },
  cards: [{ name: "Sol Ring", role: "ramp", why: "", qty: 1 }, { name: "Swamp", role: "land", why: "", qty: 10 }],
} as Deck;

test("decks: saved with the user's token, name taken from the deck itself, duplicates ignored", async () => {
  resetLimits();
  const d = await encodeDeck(deck);
  const { f, calls } = fakeSupabase((c) => {
    if (c.url.includes("/rest/v1/decks?on_conflict") && c.method === "POST") return { status: 201, body: c.body.map((r: any, i: number) => ({ ...r, id: `00000000-0000-4000-8000-00000000000${i}`, created_at: "2026-10-26T09:00:00Z" })) };
    if (c.url.includes("/rest/v1/decks?select=") && c.method === "GET") return { body: [{ id: "00000000-0000-4000-8000-000000000001", name: "X", commander: "Meren of Clan Nel Toth", partner: null, colors: "BG", bracket: 3, model: null, usage: null, created_at: "2026-10-26T09:00:00Z" }] };
  });
  const token = fresh("u7");
  const res = await handleDecks(req("/api/decks", { method: "POST", cookies: { hf_at: token }, body: { d, colors: ["G", "B", "X"], name: "<script>ignored</script>", model: "claude-sonnet-5-5", usage: { input: 10, output: 5, evil: "x" } } }), { config: cfg, fetch: f });
  assert.equal(res.status, 201, await res.clone().text());
  const call = calls.find((c) => c.method === "POST")!;
  assert.equal(call.headers.authorization, `Bearer ${token}`, "the user's token, so row-level security applies");
  assert.match(call.headers.prefer, /resolution=ignore-duplicates/);
  assert.deepEqual(call.body[0], { user_id: "u7", name: "Meren's Harvest", commander: "Meren of Clan Nel Toth", partner: null, colors: "BG", bracket: 3, d, model: "claude-sonnet-5-5", usage: { input: 10, output: 5 } });
  // a broken payload isn't saved
  assert.equal((await handleDecks(req("/api/decks", { method: "POST", cookies: { hf_at: token }, body: { d: "not-a-deck" } }), { config: cfg, fetch: f })).status, 400);
  // listing
  const list = await (await handleDecks(req("/api/decks", { cookies: { hf_at: token } }), { config: cfg, fetch: f })).json();
  assert.deepEqual(list.decks[0].colors, ["B", "G"]);
  // logged out
  assert.equal((await handleDecks(req("/api/decks"), { config: cfg, fetch: f })).status, 401);
  // without the Origin header (another site's form): refused
  assert.equal((await handleDecks(req("/api/decks", { method: "POST", cookies: { hf_at: token }, body: { d }, origin: null }), { config: cfg, fetch: f })).status, 403);
});

test("one deck: ids are checked, rename trims, delete account needs confirming", async () => {
  const { f, calls } = fakeSupabase((c) => {
    if (c.method === "PATCH") return { body: [{ id: "00000000-0000-4000-8000-000000000001", name: c.body.name, commander: "M", colors: "", created_at: "2026-10-26T09:00:00Z" }] };
    if (c.url.endsWith("/rest/v1/rpc/delete_own_account")) return { status: 204 };
  });
  const token = fresh();
  assert.equal((await handleDeck(req("/api/decks/x", { cookies: { hf_at: token } }), "1;drop table", { config: cfg, fetch: f })).status, 404);
  const r = await handleDeck(req("/api/decks/00000000-0000-4000-8000-000000000001", { method: "PATCH", cookies: { hf_at: token }, body: { name: "  New   name " } }), "00000000-0000-4000-8000-000000000001", { config: cfg, fetch: f });
  assert.equal((await r.json()).deck.name, "New name");
  assert.ok(calls[0].url.includes("decks?id=eq.00000000-0000-4000-8000-000000000001"));
  assert.equal((await handleDeleteAccount(req("/api/account/delete", { method: "POST", cookies: { hf_at: token }, body: {} }), { config: cfg, fetch: f })).status, 400);
  const del = await handleDeleteAccount(req("/api/account/delete", { method: "POST", cookies: { hf_at: token }, body: { confirm: "delete" } }), { config: cfg, fetch: f });
  assert.equal(del.status, 200);
  assert.ok(setCookies(del).some((c) => /^hf_rt=;.*Max-Age=0/.test(c)), "logged out after deleting");
});

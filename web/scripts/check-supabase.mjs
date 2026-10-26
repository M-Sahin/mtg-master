#!/usr/bin/env node
// Checks the accounts migration against a real (local) Supabase: two users, each sees and changes
// only their own decks, columns other than the name can't change, deleting an account removes its
// decks. Run after `supabase start` (CI: .github/workflows/accounts.yml):
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-supabase.mjs
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let esbuild;
try {
  esbuild = createRequire(import.meta.url)("esbuild");
} catch {
  esbuild = createRequire(import.meta.url)(process.env.ESBUILD_PATH || "/opt/npm-tools/node_modules/esbuild");
}
const entry = join(root, ".test-build", "accounts-entry.ts");
const out = join(root, ".test-build", "accounts.mjs");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `export * from "../lib/server/account-handler"; export { encodeDeck } from "../lib/shared/share";`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const { handleDecks, handleDeck, handleDeleteAccount, handleSavedKey, savedKeyFor, encodeDeck } = await import(pathToFileURL(out).href);
process.env.KEY_ENCRYPTION_SECRET ||= Buffer.alloc(32, 9).toString("base64");

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase status -o env`).");
  process.exit(1);
}
const config = { url, anonKey: anon };
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function api(path, init = {}, key = anon, token = key) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body };
}

async function user(email) {
  const made = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery staple", email_confirm: true }) }, service);
  if (made.status >= 300) throw new Error(`create ${email}: ${made.status} ${JSON.stringify(made.body)}`);
  const s = await api("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery staple" }) });
  if (s.status >= 300) throw new Error(`sign in ${email}: ${s.status} ${JSON.stringify(s.body)}`);
  return { id: s.body.user.id, token: s.body.access_token };
}

const SITE = "http://localhost:3000";
const req = (path, token, init = {}) =>
  new Request(`${SITE}${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", cookie: `hf_at=${encodeURIComponent(token)}`, ...(init.method && init.method !== "GET" ? { origin: SITE } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

const deck = (name) => ({
  name, strategy: "", winConditions: [], bracketNotes: "", colorIdentity: ["B", "G"], bracket: 3,
  commander: { name: "Meren of Clan Nel Toth", role: "wincon", why: "", qty: 1 },
  cards: [{ name: "Sol Ring", role: "ramp", why: "", qty: 1 }, { name: `Card for ${name}`, role: "synergy", why: "", qty: 1 }],
});

const stamp = Date.now();
const a = await user(`a${stamp}@example.com`);
const b = await user(`b${stamp}@example.com`);
const dA = await encodeDeck(deck("Deck of A"));

// save, and save again (one row)
let r = await handleDecks(req("/api/decks", a.token, { method: "POST", body: { d: dA, colors: ["B", "G"] } }), { config });
const savedA = (await r.json()).saved?.[0];
check(r.status === 201 && savedA?.name === "Deck of A", `A saves a deck (${r.status})`);
r = await handleDecks(req("/api/decks", a.token, { method: "POST", body: { d: dA } }), { config });
const again = await r.json();
check(r.status === 201 && again.duplicates === 1 && again.saved.length === 0, "saving the same deck again adds no row");
r = await handleDecks(req("/api/decks", a.token, { method: "POST", body: { decks: [{ d: dA }, { d: await encodeDeck(deck("Second of A")) }] } }), { config });
check((await r.json()).saved?.length === 1, "importing skips the deck already saved");

// the other user sees nothing of A's
const listA = await (await handleDecks(req("/api/decks", a.token), { config })).json();
const listB = await (await handleDecks(req("/api/decks", b.token), { config })).json();
check(listA.decks?.length === 2, `A lists 2 decks (${listA.decks?.length})`);
check(Array.isArray(listB.decks) && listB.decks.length === 0, "B lists none of A's decks");
r = await handleDeck(req(`/api/decks/${savedA.id}`, b.token), savedA.id, { config });
check(r.status === 404, `B can't open A's deck (${r.status})`);
r = await handleDeck(req(`/api/decks/${savedA.id}`, b.token, { method: "PATCH", body: { name: "stolen" } }), savedA.id, { config });
check(r.status === 404, `B can't rename A's deck (${r.status})`);
await handleDeck(req(`/api/decks/${savedA.id}`, b.token, { method: "DELETE" }), savedA.id, { config });
const stillThere = await (await handleDeck(req(`/api/decks/${savedA.id}`, a.token), savedA.id, { config })).json();
check(stillThere.deck?.d === dA, "B's delete doesn't touch A's deck; A opens it with its payload");

// straight to the database, around our server
const sneaky = await api("/rest/v1/decks", { method: "POST", body: JSON.stringify({ user_id: a.id, name: "planted", commander: "x", d: dA.slice(0, 50) + "x" }) }, anon, b.token);
check(sneaky.status >= 400, `B can't insert a deck into A's account (${sneaky.status})`);
const anonRead = await api("/rest/v1/decks?select=id");
check(anonRead.status >= 400 || (Array.isArray(anonRead.body) && anonRead.body.length === 0), `logged out, the table reads empty or refuses (${anonRead.status})`);
const col = await api(`/rest/v1/decks?id=eq.${savedA.id}`, { method: "PATCH", body: JSON.stringify({ commander: "Changed" }) }, anon, a.token);
check(col.status >= 400, `even the owner can only change the name (${col.status})`);
r = await handleDeck(req(`/api/decks/${savedA.id}`, a.token, { method: "PATCH", body: { name: "Renamed" } }), savedA.id, { config });
check((await r.json()).deck?.name === "Renamed", "A renames their deck");

// saved API keys: A saves one; B and logged-out visitors can't read it; only the server opens it
const KEY = "sk-ant-api03-" + "q".repeat(40) + "LAST";
const fakeModels = async () => [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }];
r = await handleSavedKey(req("/api/account/key", a.token, { method: "PUT", body: { key: KEY, model: "claude-sonnet-5-5" } }), { config, listModels: fakeModels });
check(r.status === 200, `A saves a key (${r.status})`);
const rowA = await api(`/rest/v1/api_keys?select=sealed,last4&user_id=eq.${a.id}`, {}, service);
check(rowA.body?.[0]?.last4 === "LAST" && !JSON.stringify(rowA.body).includes(KEY), "the key is stored sealed, with its last four");
check((await savedKeyFor(req("/api/generate", a.token), { config }))?.key === KEY, "a build of A opens A's key");
const bReads = await api("/rest/v1/api_keys?select=sealed", {}, anon, b.token);
check(Array.isArray(bReads.body) && bReads.body.length === 0, "B can't read A's saved key");
check((await savedKeyFor(req("/api/generate", b.token), { config })) === null, "a build of B gets no key");
const anonKeys = await api("/rest/v1/api_keys?select=sealed");
check(!Array.isArray(anonKeys.body) || anonKeys.body.length === 0, "logged out, no saved keys can be read");
const planted = await api("/rest/v1/api_keys", { method: "POST", body: JSON.stringify({ user_id: a.id, sealed: "x".repeat(60), last4: "EVIL" }) }, anon, b.token);
check(planted.status >= 400, `B can't write a key into A's account (${planted.status})`);
// a sealed key copied into B's row doesn't open for B
await api("/rest/v1/api_keys", { method: "POST", body: JSON.stringify({ user_id: b.id, sealed: rowA.body?.[0]?.sealed, last4: "LAST" }) }, anon, b.token);
check((await savedKeyFor(req("/api/generate", b.token), { config })) === null, "A's sealed key copied to B doesn't open for B");

// delete the account: the decks go with it
r = await handleDeleteAccount(req("/api/account/delete", a.token, { method: "POST", body: { confirm: "delete" } }), { config });
check(r.status === 200, `A deletes their account (${r.status})`);
const left = await api(`/rest/v1/decks?select=id&user_id=eq.${a.id}`, {}, service);
check(Array.isArray(left.body) && left.body.length === 0, `A's decks are gone (${left.body?.length})`);
const keysLeft = await api(`/rest/v1/api_keys?select=user_id&user_id=eq.${a.id}`, {}, service);
check(Array.isArray(keysLeft.body) && keysLeft.body.length === 0, "A's saved key is gone");
const gone = await api(`/auth/v1/admin/users/${a.id}`, {}, service);
check(gone.status === 404, `A's user is gone (${gone.status})`);
const bDelete = await api("/rest/v1/rpc/delete_own_account", { method: "POST", body: "{}" });
check(bDelete.status >= 400, `logged out, delete_own_account refuses (${bDelete.status})`);

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll account checks passed");
process.exit(failures.length ? 1 : 0);

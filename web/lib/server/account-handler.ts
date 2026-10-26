// Accounts and saved decks: framework-independent handlers behind the /api/auth, /auth and
// /api/decks routes (lib/server/supabase.ts does the talking to Supabase).
import { decodePayload } from "../shared/share";
import { canonicalOrigin } from "./share-handler";
import {
  COOKIE,
  clearSessionCookies,
  cookie,
  enabledProviders,
  exchangeCode,
  isSecure,
  oauthUrl,
  pkceChallenge,
  pkceVerifier,
  publicUser,
  readCookies,
  requestAuth,
  rest,
  safeNext,
  sendMagicLink,
  sessionCookies,
  signOut,
  supabaseConfig,
  SupabaseError,
  type Fetch,
  type SupabaseConfig,
} from "./supabase";

export interface Deps {
  fetch?: Fetch;
  config?: SupabaseConfig | null;
}

const cfgOf = (deps: Deps) => (deps.config !== undefined ? deps.config : supabaseConfig());

function json(body: unknown, status = 200, setCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(to: string, setCookies: string[] = []): Response {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

const OFF = () => json({ error: "Accounts aren't set up on this site." }, 404);

/** Changes must come from our own pages: SameSite cookies plus an Origin check. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const clientIp = (r: Request) => (r.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || r.headers.get("x-real-ip")?.trim() || "unknown";

const hits = new Map<string, number[]>();
export function limited(key: string, perHour: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  const over = recent.length >= perHour;
  if (!over) recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return over;
}
export const resetLimits = () => hits.clear();

function friendly(e: unknown): string {
  if (e instanceof SupabaseError) {
    if (/rate limit|too many|email rate/i.test(e.message)) return "Too many login emails were sent just now. Try again in a little while, or log in with Discord or Google.";
    if (/deck limit/i.test(e.message)) return "Your account has 1,000 decks, the most it can keep. Delete some to save new ones.";
    if (e.status === 401 || e.status === 403) return "Your session ended. Log in again.";
  }
  return "The account service didn't answer. Try again in a minute.";
}

// ---- auth -------------------------------------------------------------------------

/** GET /api/auth/session: whether accounts are on, which login options there are, and who's logged in. */
export async function handleSession(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return json({ enabled: false, providers: [], user: null });
  const [auth, providers] = await Promise.all([requestAuth(request, cfg, deps.fetch).catch(() => ({ user: null, setCookies: [] as string[] })), enabledProviders(cfg, deps.fetch)]);
  return json({ enabled: true, providers, user: auth.user ? publicUser(auth.user) : null }, 200, auth.setCookies);
}

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i;

/** POST /api/auth/email {email, next}: send a magic link. */
export async function handleEmail(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return OFF();
  if (!sameOrigin(request)) return json({ error: "Bad request." }, 403);
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "That doesn't look like an email address." }, 400);
  if (limited(`ip:${clientIp(request)}`, 10) || limited(`email:${email}`, 3)) return json({ error: "Too many login emails. Wait a bit, then try again." }, 429);
  const verifier = pkceVerifier();
  const secure = isSecure(request);
  try {
    await sendMagicLink(cfg, email, `${canonicalOrigin(request)}/auth/callback`, await pkceChallenge(verifier), deps.fetch);
  } catch (e) {
    return json({ error: friendly(e) }, 502);
  }
  return json({ sent: true }, 200, [cookie(COOKIE.verifier, verifier, 3600, secure), cookie(COOKIE.next, safeNext(body?.next), 3600, secure)]);
}

/** GET /api/auth/oauth?provider=discord&next=/: off to the provider's login page. */
export async function handleOAuth(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return OFF();
  const u = new URL(request.url);
  const provider = u.searchParams.get("provider");
  if (provider !== "discord" && provider !== "google") return json({ error: "Unknown login provider." }, 400);
  const verifier = pkceVerifier();
  const secure = isSecure(request);
  return redirect(oauthUrl(cfg, provider, `${canonicalOrigin(request)}/auth/callback`, await pkceChallenge(verifier)), [
    cookie(COOKIE.verifier, verifier, 900, secure),
    cookie(COOKIE.next, safeNext(u.searchParams.get("next")), 900, secure),
  ]);
}

/** GET /auth/callback?code=…: finish a login (magic link or provider) and go back where the user was. */
export async function handleCallback(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return redirect("/");
  const u = new URL(request.url);
  const c = readCookies(request);
  const secure = isSecure(request);
  const next = safeNext(c[COOKIE.next]);
  const clear = [cookie(COOKIE.verifier, "", 0, secure), cookie(COOKIE.next, "", 0, secure)];
  const fail = (why: string) => redirect(`/account?login=${encodeURIComponent(why)}`, clear);
  const err = u.searchParams.get("error_description") ?? u.searchParams.get("error");
  if (err) return fail(/expired|invalid/i.test(err) ? "expired" : "failed");
  const code = u.searchParams.get("code");
  const verifier = c[COOKIE.verifier];
  if (!code) return fail("failed");
  // a magic link opened in another browser or app has no verifier cookie
  if (!verifier) return fail("other-browser");
  try {
    const s = await exchangeCode(cfg, code, verifier, deps.fetch);
    return redirect(next, [...clear, ...sessionCookies(s, secure)]);
  } catch (e) {
    return fail(e instanceof SupabaseError && e.status < 500 ? "expired" : "failed");
  }
}

/** POST /api/auth/logout */
export async function handleLogout(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return OFF();
  if (!sameOrigin(request)) return json({ error: "Bad request." }, 403);
  const token = readCookies(request)[COOKIE.access];
  if (token) await signOut(cfg, token, deps.fetch);
  return json({ ok: true }, 200, clearSessionCookies(isSecure(request)));
}

/** POST /api/account/delete: delete the account and every deck in it. */
export async function handleDeleteAccount(request: Request, deps: Deps = {}): Promise<Response> {
  const cfg = cfgOf(deps);
  if (!cfg) return OFF();
  if (!sameOrigin(request)) return json({ error: "Bad request." }, 403);
  const body = await request.json().catch(() => null);
  if (body?.confirm !== "delete") return json({ error: "Confirm by sending confirm: \"delete\"." }, 400);
  const auth = await requestAuth(request, cfg, deps.fetch).catch(() => null);
  if (!auth || !auth.user) return json({ error: "Log in first." }, 401);
  try {
    await rest(cfg, auth.token, "rpc/delete_own_account", { method: "POST", body: "{}" }, deps.fetch);
  } catch (e) {
    return json({ error: friendly(e) }, 502, auth.setCookies);
  }
  return json({ deleted: true }, 200, clearSessionCookies(isSecure(request)));
}

// ---- decks ------------------------------------------------------------------------

export interface CloudDeck {
  id: string;
  at: number;
  name: string;
  commander: string;
  partner?: string;
  colors: string[];
  bracket?: number;
  model?: string;
  usage?: Record<string, number>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = "id,name,commander,partner,colors,bracket,model,usage,created_at";

function toCloud(r: any): CloudDeck {
  return {
    id: r.id,
    at: Date.parse(r.created_at) || 0,
    name: r.name,
    commander: r.commander,
    ...(r.partner ? { partner: r.partner } : {}),
    colors: String(r.colors ?? "").split("").filter(Boolean),
    ...(r.bracket ? { bracket: r.bracket } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
  };
}

/** A deck to save, rebuilt from its payload: name and commander come from the deck itself, not the client. */
async function deckRow(x: any, userId: string) {
  const d = String(x?.d ?? "");
  const p = await decodePayload(d); // throws on a broken payload
  const colors = Array.isArray(x?.colors) ? x.colors.filter((c: unknown) => typeof c === "string" && /^[WUBRG]$/.test(c)) : [];
  const usage: Record<string, number> = {};
  for (const k of ["calls", "input", "output", "cacheRead", "cacheWrite"]) {
    const v = Number(x?.usage?.[k]);
    if (Number.isFinite(v) && v >= 0 && v < 1e9) usage[k] = Math.round(v);
  }
  const model = typeof x?.model === "string" && /^[\w.-]{1,80}$/.test(x.model) ? x.model : null;
  return {
    user_id: userId,
    name: p.n.slice(0, 120) || "Untitled deck",
    commander: p.c.slice(0, 150),
    partner: p.p ? p.p.slice(0, 150) : null,
    colors: ["W", "U", "B", "R", "G"].filter((c) => colors.includes(c)).join(""),
    bracket: p.br ?? 3,
    d,
    model,
    usage: Object.keys(usage).length ? usage : null,
  };
}

async function authed(request: Request, deps: Deps) {
  const cfg = cfgOf(deps);
  if (!cfg) return { res: OFF() } as const;
  const auth = await requestAuth(request, cfg, deps.fetch).catch(() => null);
  if (!auth) return { res: json({ error: "The account service didn't answer. Try again in a minute." }, 502) } as const;
  if (!auth.user) return { res: json({ error: "Log in to use your saved decks." }, 401, auth.setCookies) } as const;
  return { cfg, auth } as const;
}

/** GET /api/decks: the account's decks, newest first. POST: save one ({d, colors, model, usage}) or import many ({decks: [...]}). */
export async function handleDecks(request: Request, deps: Deps = {}): Promise<Response> {
  const a = await authed(request, deps);
  if ("res" in a) return a.res!;
  const { cfg, auth } = a;
  try {
    if (request.method === "GET") {
      const rows = await rest<any[]>(cfg, auth.token, `decks?select=${LIST}&order=created_at.desc&limit=1000`, { method: "GET" }, deps.fetch);
      return json({ decks: rows.map(toCloud) }, 200, auth.setCookies);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!sameOrigin(request)) return json({ error: "Bad request." }, 403);
    if (Number(request.headers.get("content-length") ?? 0) > 1_200_000) return json({ error: "Too much at once." }, 413);
    if (limited(`save:${auth.user.id}`, 120)) return json({ error: "Too many saves this hour." }, 429, auth.setCookies);
    const body = await request.json().catch(() => null);
    const items: unknown[] = Array.isArray(body?.decks) ? body.decks.slice(0, 100) : body?.d ? [body] : [];
    if (!items.length) return json({ error: "No deck to save." }, 400, auth.setCookies);
    const rows = [];
    let skipped = 0;
    for (const x of items) {
      try {
        rows.push(await deckRow(x, auth.user.id));
      } catch {
        skipped++;
      }
    }
    if (!rows.length) return json({ error: "That deck couldn't be read." }, 400, auth.setCookies);
    // the same deck twice is one row (unique user_id + payload hash): ignore duplicates
    const saved = await rest<any[]>(cfg, auth.token, `decks?on_conflict=user_id,d_hash&select=${LIST}`, { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(rows) }, deps.fetch);
    return json({ saved: saved.map(toCloud), duplicates: rows.length - saved.length, skipped }, 201, auth.setCookies);
  } catch (e) {
    return json({ error: friendly(e) }, e instanceof SupabaseError && e.status === 401 ? 401 : 502, auth.setCookies);
  }
}

/** GET /api/decks/<id>: the deck payload. PATCH {name}: rename. DELETE: remove. */
export async function handleDeck(request: Request, id: string, deps: Deps = {}): Promise<Response> {
  if (!UUID.test(id)) return json({ error: "Unknown deck." }, 404);
  const a = await authed(request, deps);
  if ("res" in a) return a.res!;
  const { cfg, auth } = a;
  const where = `decks?id=eq.${id}`;
  try {
    if (request.method === "GET") {
      const rows = await rest<any[]>(cfg, auth.token, `${where}&select=${LIST},d`, { method: "GET" }, deps.fetch);
      if (!rows.length) return json({ error: "Unknown deck." }, 404, auth.setCookies);
      return json({ deck: { ...toCloud(rows[0]), d: rows[0].d } }, 200, auth.setCookies);
    }
    if (!sameOrigin(request)) return json({ error: "Bad request." }, 403);
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => null);
      const name = String(body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!name) return json({ error: "Give the deck a name." }, 400, auth.setCookies);
      const rows = await rest<any[]>(cfg, auth.token, `${where}&select=${LIST}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ name }) }, deps.fetch);
      if (!rows.length) return json({ error: "Unknown deck." }, 404, auth.setCookies);
      return json({ deck: toCloud(rows[0]) }, 200, auth.setCookies);
    }
    if (request.method === "DELETE") {
      await rest(cfg, auth.token, where, { method: "DELETE" }, deps.fetch);
      return json({ deleted: true }, 200, auth.setCookies);
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (e) {
    return json({ error: friendly(e) }, 502, auth.setCookies);
  }
}

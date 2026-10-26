// Accounts with Supabase, without the SDK: its Auth and REST (PostgREST) APIs over fetch.
// Sessions live in httpOnly cookies set by our own routes, so tokens never reach page
// scripts and the Content Security Policy stays 'self'. Row-level security in the database
// (supabase/migrations) decides what each user may read and change.
//
// Off unless SUPABASE_URL and SUPABASE_ANON_KEY (or the publishable key) are set.

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!/^https?:\/\/[^\s"'<>]+$/.test(url) || !anonKey) return null;
  // plain http only for a local Supabase (supabase start)
  if (url.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return null;
  return { url, anonKey };
}

export type Fetch = typeof fetch;

// ---- PKCE -------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pkceVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return b64url(bytes); // 64 characters, within PKCE's 43–128
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

// ---- cookies ----------------------------------------------------------------------

export const COOKIE = { access: "hf_at", refresh: "hf_rt", verifier: "hf_pkce", next: "hf_next" } as const;

export function readCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

/** A Set-Cookie value: httpOnly, SameSite=Lax, Secure except on plain-http localhost. */
export function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const isSecure = (request: Request) => {
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return proto === "https" || !/^(localhost|127\.0\.0\.1)$/.test(u.hostname);
};

/** Only same-site paths: "/", "/#my-decks", "/account". Never "//evil.example". */
export function safeNext(next: string | null | undefined): string {
  const n = (next ?? "").trim();
  return /^\/(?!\/)[\w\-./#?=&%]*$/.test(n) && !n.includes("\\") ? n.slice(0, 200) : "/";
}

// ---- Auth API -----------------------------------------------------------------------

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: AuthUser;
}

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: { provider?: string };
}

export class SupabaseError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(cfg: SupabaseConfig, path: string, init: RequestInit & { token?: string } = {}, f: Fetch = fetch): Promise<T> {
  const headers: Record<string, string> = { apikey: cfg.anonKey, "content-type": "application/json", ...(init.headers as Record<string, string>) };
  // a user token, or the classic anon key (a JWT); the newer publishable keys go in apikey only
  const bearer = init.token ?? (cfg.anonKey.split(".").length === 3 ? cfg.anonKey : null);
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await f(`${cfg.url}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(12_000) });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = body?.msg ?? body?.message ?? body?.error_description ?? body?.error ?? `Supabase ${res.status}`;
    throw new SupabaseError(String(msg), res.status);
  }
  return body as T;
}

/** Providers switched on in the Supabase project (Auth settings), e.g. ["email", "discord"]. */
let providerCache: { at: number; list: string[] } | null = null;
export async function enabledProviders(cfg: SupabaseConfig, f?: Fetch): Promise<string[]> {
  if (providerCache && Date.now() - providerCache.at < 10 * 60_000) return providerCache.list;
  try {
    const s = await call<{ external?: Record<string, boolean>; disable_signup?: boolean }>(cfg, "/auth/v1/settings", { method: "GET" }, f);
    const list = ["email", "discord", "google"].filter((p) => s.external?.[p]);
    providerCache = { at: Date.now(), list };
    return list;
  } catch {
    return providerCache?.list ?? ["email"];
  }
}
export function resetProviderCache() {
  providerCache = null;
}

/** Send a magic link (creates the account on first use). The link comes back to /auth/callback?code=… */
export function sendMagicLink(cfg: SupabaseConfig, email: string, redirectTo: string, challenge: string, f?: Fetch) {
  return call<unknown>(cfg, `/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { method: "POST", body: JSON.stringify({ email, create_user: true, code_challenge: challenge, code_challenge_method: "s256" }) }, f);
}

/** Where to send the browser for "Log in with Discord/Google". */
export function oauthUrl(cfg: SupabaseConfig, provider: "discord" | "google", redirectTo: string, challenge: string): string {
  const q = new URLSearchParams({ provider, redirect_to: redirectTo, code_challenge: challenge, code_challenge_method: "s256" });
  return `${cfg.url}/auth/v1/authorize?${q}`;
}

export function exchangeCode(cfg: SupabaseConfig, code: string, verifier: string, f?: Fetch) {
  return call<Session>(cfg, "/auth/v1/token?grant_type=pkce", { method: "POST", body: JSON.stringify({ auth_code: code, code_verifier: verifier }) }, f);
}

export function refreshSession(cfg: SupabaseConfig, refreshToken: string, f?: Fetch) {
  return call<Session>(cfg, "/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }, f);
}

export function getUser(cfg: SupabaseConfig, token: string, f?: Fetch) {
  return call<AuthUser>(cfg, "/auth/v1/user", { method: "GET", token }, f);
}

export function signOut(cfg: SupabaseConfig, token: string, f?: Fetch) {
  return call<unknown>(cfg, "/auth/v1/logout?scope=local", { method: "POST", token }, f).catch(() => null);
}

/** PostgREST with the user's token: row-level security applies. */
export function rest<T>(cfg: SupabaseConfig, token: string, path: string, init: RequestInit = {}, f?: Fetch) {
  return call<T>(cfg, `/rest/v1/${path}`, { ...init, token }, f);
}

// ---- the session behind a request ----------------------------------------------------

function jwtPayload(token: string): Record<string, any> | null {
  try {
    const bin = atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))); // UTF-8 names stay intact
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

/**
 * The user named in an access token. Not verified here on purpose: we only use it to show who
 * is signed in and pass the token on; Supabase checks the signature on every database call, so
 * a forged token gets nothing.
 */
export function tokenUser(token: string): (AuthUser & { exp: number }) | null {
  const p = jwtPayload(token);
  if (!p || typeof p.sub !== "string" || typeof p.exp !== "number" || p.role !== "authenticated") return null;
  return { id: p.sub, email: typeof p.email === "string" ? p.email : undefined, user_metadata: p.user_metadata ?? {}, app_metadata: p.app_metadata ?? {}, exp: p.exp * 1000 };
}

export const REFRESH_MAX_AGE = 60 * 60 * 24 * 60; // stay logged in for 60 days of no use

export function sessionCookies(s: Session, secure: boolean): string[] {
  return [cookie(COOKIE.access, s.access_token, s.expires_in || 3600, secure), cookie(COOKIE.refresh, s.refresh_token, REFRESH_MAX_AGE, secure)];
}

export function clearSessionCookies(secure: boolean): string[] {
  return [cookie(COOKIE.access, "", 0, secure), cookie(COOKIE.refresh, "", 0, secure)];
}

export interface RequestAuth {
  user: AuthUser;
  token: string;
  /** Set-Cookie values to send back (a refreshed session). */
  setCookies: string[];
}

/**
 * The signed-in user of a request, refreshing the access token when it's about to expire.
 * null = not signed in (or the session can't be refreshed; the cookies are then cleared).
 */
export async function requestAuth(request: Request, cfg: SupabaseConfig, f?: Fetch): Promise<RequestAuth | { user: null; setCookies: string[] }> {
  const c = readCookies(request);
  const secure = isSecure(request);
  const token = c[COOKIE.access];
  const fromToken = token ? tokenUser(token) : null;
  // still valid for more than a minute: no network call needed
  if (token && fromToken && fromToken.exp - Date.now() > 60_000) return { user: fromToken, token, setCookies: [] };
  const rt = c[COOKIE.refresh];
  if (!rt) return { user: null, setCookies: token ? clearSessionCookies(secure) : [] };
  try {
    const s = await refreshSession(cfg, rt, f);
    return { user: s.user, token: s.access_token, setCookies: sessionCookies(s, secure) };
  } catch (e) {
    // a refresh token that's revoked, used up or expired ends the session; a rate limit, an
    // outage or a network error doesn't (the cookies stay and the next request tries again)
    if (refreshIsDead(e)) return { user: null, setCookies: clearSessionCookies(secure) };
    throw e;
  }
}

export function refreshIsDead(e: unknown): boolean {
  return e instanceof SupabaseError && [400, 401, 403, 404].includes(e.status) && !/rate limit|too many/i.test(e.message);
}

/**
 * The site's own address, for login redirects. Never taken from request headers on a real
 * deployment (a forged Host / X-Forwarded-Host could send login links elsewhere): SITE_URL,
 * else Vercel's own URLs (production domain, or this preview), else localhost for development.
 * null = unknown: logins are refused until SITE_URL is set.
 */
export function siteOrigin(request: Request): string | null {
  const site = process.env.SITE_URL?.trim();
  if (site && /^https?:\/\/[^\s/"'<>]+\/?$/.test(site)) return site.replace(/\/+$/, "");
  if (process.env.VERCEL) {
    const host = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
    if (host) return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  const u = new URL(request.url);
  return /^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? u.origin : null;
}

export function publicUser(u: AuthUser) {
  const m = u.user_metadata ?? {};
  const name = [m.full_name, m.name, m.user_name, m.preferred_username].find((x) => typeof x === "string" && x.trim()) as string | undefined;
  return { id: u.id, email: u.email ?? null, name: name?.slice(0, 60) ?? (u.email ? u.email.split("@")[0] : "Player"), provider: u.app_metadata?.provider ?? "email" };
}

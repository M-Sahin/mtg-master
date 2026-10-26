// Cloudflare Turnstile: a free, mostly invisible check that a request comes from a person's
// browser, not a script. On when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.
//
// - The bracket checker (and "Read my deck") send a token that this server verifies.
// - Login emails send theirs to Supabase, which verifies it when CAPTCHA is switched on in the
//   Supabase dashboard (same secret). That also stops scripts that call Supabase directly.
// A token can be verified only once, so each one goes to exactly one of the two.

export function turnstileSiteKey(): string | null {
  const k = (process.env.TURNSTILE_SITE_KEY ?? "").trim();
  return /^[\w-]{10,100}$/.test(k) ? k : null;
}

const secret = () => (process.env.TURNSTILE_SECRET_KEY ?? "").trim();
export const turnstileOn = () => !!(turnstileSiteKey() && secret());

export interface TurnstileResult {
  ok: boolean;
  /** why it failed, for the error message */
  reason?: "missing" | "invalid" | "unavailable";
}

/** Verify a token with Cloudflare. Always ok when Turnstile isn't set up on this server. */
export async function verifyTurnstile(token: unknown, ip: string | null, action?: string, f: typeof fetch = fetch): Promise<TurnstileResult> {
  if (!turnstileOn()) return { ok: true };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, reason: "missing" };
  const form = new URLSearchParams({ secret: secret(), response: token });
  if (ip && ip !== "unknown" && !ip.includes("/")) form.set("remoteip", ip);
  try {
    const res = await f("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { success?: boolean; action?: string };
    if (!j.success) return { ok: false, reason: "invalid" };
    // a token made for another form (e.g. the login) doesn't open this one
    if (action && j.action && j.action !== action) return { ok: false, reason: "invalid" };
    return { ok: true };
  } catch {
    // Cloudflare unreachable: let people through rather than lock everyone out; the rate limits still apply
    return { ok: true, reason: "unavailable" };
  }
}

export function turnstileError(r: TurnstileResult): Response {
  const msg = r.reason === "missing" ? "Wait a moment for the check that you're not a bot, then try again." : "The check that you're not a bot failed. Reload the page and try again.";
  return Response.json({ error: msg }, { status: 403 });
}

// Visitors' own Claude API keys saved to their account, sealed with AES-256-GCM.
// KEY_ENCRYPTION_SECRET (32 random bytes, base64) lives only in the server's environment; the
// database holds the sealed key and its last four characters. The user's id is the additional
// data, so a sealed key copied to another user's row doesn't open.
// Make a secret with: openssl rand -base64 32

/** Claude API keys look like sk-ant-…; anything else is rejected before it reaches Anthropic. */
export const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

function secretBytes(): Uint8Array | null {
  const raw = (process.env.KEY_ENCRYPTION_SECRET ?? "").trim();
  if (!raw) return null;
  try {
    const b = Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

export const vaultOn = () => !!secretBytes();

async function aesKey(): Promise<CryptoKey> {
  const b = secretBytes();
  if (!b) throw new Error("KEY_ENCRYPTION_SECRET isn't set (32 random bytes, base64).");
  return crypto.subtle.importKey("raw", b.slice(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function sealKey(key: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await aesKey(), new TextEncoder().encode(key)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** The key, or null when it doesn't open (another user's row, a changed secret, a damaged value). */
export async function openKey(sealed: string, userId: string): Promise<string | null> {
  try {
    const b = fromB64url(sealed);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: new TextEncoder().encode(userId) }, await aesKey(), b.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

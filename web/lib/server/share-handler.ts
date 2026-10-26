// POST /api/share {d} -> { url, short }. Share links always point at the public site:
// SITE_URL if set, else the project's production domain on Vercel (deployment URLs sit behind
// Vercel's login by default), else the address the request came in on.
import { LIMITS, clientIp, rateLimit } from "./ratelimit";
import { decodePayload } from "../shared/share";
import { kvConfig, saveShare } from "./store";

export function canonicalOrigin(request: Request): string {
  const site = process.env.SITE_URL?.trim();
  if (site) return site.replace(/\/+$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}


export async function handleShare(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const d = typeof body?.d === "string" ? body.d : "";
  try {
    await decodePayload(d); // only valid decks get stored or linked
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Invalid deck." }, { status: 400 });
  }
  const origin = canonicalOrigin(request);
  const long = `${origin}/deck?d=${d}`;
  if (!kvConfig()) return Response.json({ url: long, short: false });
  const ip = clientIp(request);
  // past the limit: still a working (long, self-contained) link, just not a stored one
  if (!(await rateLimit(LIMITS.share, ip)).ok) return Response.json({ url: long, short: false });
  try {
    const id = await saveShare(d);
    return Response.json({ url: `${origin}/d/${id}`, short: true });
  } catch {
    return Response.json({ url: long, short: false }); // store down: the long link still works
  }
}

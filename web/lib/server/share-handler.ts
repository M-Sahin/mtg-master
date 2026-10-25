// POST /api/share {d} -> { url, short }. Share links always point at the public site:
// SITE_URL if set, else the project's production domain on Vercel (deployment URLs sit behind
// Vercel's login by default), else the address the request came in on.
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

// best-effort write limit per IP and instance, so the store can't be filled by a script
const writes = new Map<string, number[]>();
function tooMany(ip: string, perHour = 60, now = Date.now()) {
  const recent = (writes.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  writes.set(ip, recent);
  if (writes.size > 5000) writes.delete(writes.keys().next().value as string);
  return recent.length > perHour;
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
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  if (tooMany(ip)) return Response.json({ url: long, short: false });
  try {
    const id = await saveShare(d);
    return Response.json({ url: `${origin}/d/${id}`, short: true });
  } catch {
    return Response.json({ url: long, short: false }); // store down: the long link still works
  }
}

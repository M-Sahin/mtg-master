// Link-preview metadata (Open Graph / Twitter) for a shared deck, used by /deck?d=… and /d/<id>.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { decodePayload, shareTitle } from "../shared/share";

/** The address this page was requested on (crawlers fetch the shared link itself). */
export async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function deckMetadata(d: string, pagePath: string): Promise<Metadata> {
  try {
    const p = await decodePayload(d);
    const base = await requestOrigin();
    const title = shareTitle(p);
    const description = (p.s ?? "A complete 100-card Commander deck built by Claude from five seed cards.").slice(0, 200);
    const image = `${base}/api/og?d=${d}`;
    return {
      title,
      description,
      metadataBase: new URL(base),
      openGraph: { title, description, type: "website", url: `${base}${pagePath}`, images: [{ url: image, width: 800, height: 420 }] },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    return { title: "Shared deck · Hundredfoldz" };
  }
}

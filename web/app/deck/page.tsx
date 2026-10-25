import type { Metadata } from "next";
import { headers } from "next/headers";
import SharedDeck from "../../components/SharedDeck";
import { decodePayload, shareTitle } from "../../lib/shared/share";

type Props = { searchParams: Promise<{ d?: string | string[] }> };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const d = (await searchParams).d;
  const value = typeof d === "string" ? d : "";
  try {
    const p = await decodePayload(value);
    const base = await origin();
    const title = shareTitle(p);
    const description = (p.s ?? "A complete 100-card Commander deck built by Claude from five seed cards.").slice(0, 200);
    const image = `${base}/api/og?d=${value}`;
    return {
      title,
      description,
      metadataBase: new URL(base),
      openGraph: { title, description, type: "website", url: `${base}/deck?d=${value}`, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    return { title: "Shared deck · Hundredfold" };
  }
}

export default async function Page({ searchParams }: Props) {
  const d = (await searchParams).d;
  return <SharedDeck d={typeof d === "string" ? d : ""} />;
}

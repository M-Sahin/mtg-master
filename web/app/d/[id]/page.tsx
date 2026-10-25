// Short share links: /d/<id> looks the deck up in the store (lib/server/store.ts).
import type { Metadata } from "next";
import SharedDeck from "../../../components/SharedDeck";
import { deckMetadata } from "../../../lib/server/deck-meta";
import { loadShare } from "../../../lib/server/store";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function lookup(props: Props): Promise<string | null> {
  const { id } = await props.params;
  try {
    return await loadShare(id);
  } catch {
    return null;
  }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await lookup(props);
  const { id } = await props.params;
  return d ? deckMetadata(d, `/d/${id}`) : { title: "Shared deck · Hundredfold" };
}

export default async function Page(props: Props) {
  const d = await lookup(props);
  return <SharedDeck d={d ?? ""} missing={!d} />;
}

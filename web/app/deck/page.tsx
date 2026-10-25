import type { Metadata } from "next";
import SharedDeck from "../../components/SharedDeck";
import { deckMetadata } from "../../lib/server/deck-meta";

type Props = { searchParams: Promise<{ d?: string | string[] }> };

const param = async (p: Props) => {
  const d = (await p.searchParams).d;
  return typeof d === "string" ? d : "";
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await param(props);
  return deckMetadata(d, `/deck?d=${d}`);
}

export default async function Page(props: Props) {
  return <SharedDeck d={await param(props)} />;
}

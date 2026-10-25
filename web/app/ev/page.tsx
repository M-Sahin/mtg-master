import type { Metadata } from "next";
import EvIndexView from "../../components/EvIndexView";
import { evIndex } from "../../lib/server/ev-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MTG booster box EV · Hundredfoldz",
  description: "What every Magic booster box since 2020 is worth on average: card value from the published pack odds and Cardmarket prices, after selling costs. Free, no account.",
};

export default async function Page() {
  let index = null;
  let error: string | null = null;
  try {
    index = await evIndex();
    if (!index) error = "No Box EV data has been published yet. It's built once a day by the ev-data workflow.";
  } catch {
    error = "The Box EV data couldn't be loaded. Try again in a minute.";
  }
  return <EvIndexView index={index} error={error} />;
}

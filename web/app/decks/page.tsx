import type { Metadata } from "next";
import DecksPage from "../../components/DecksPage";

export const metadata: Metadata = { title: "My decks · Hundredfoldz", robots: { index: false } };

export default function Page() {
  return <DecksPage />;
}

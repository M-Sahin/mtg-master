import type { Metadata } from "next";
import BracketChecker from "../../components/BracketChecker";

export const metadata: Metadata = {
  title: "Commander bracket checker · Hundredfold",
  description: "Paste any Commander decklist and see which bracket it fits: Game Changers, combos, mass land denial and extra turns, checked against Scryfall and Commander Spellbook. Free.",
};

export default function Page() {
  return <BracketChecker />;
}

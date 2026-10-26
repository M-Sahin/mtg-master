"use client";
// Singles or boxes? For a deck: the booster boxes its cards come in, how much of the deck one box
// gives on average, and what those cards cost as singles.
import { useEffect, useState } from "react";
import type { DeckBoxRow } from "../lib/shared/ev";
import type { Deck } from "../lib/shared/types";
import { isBasicLand } from "../lib/shared/types";

const eur = (x: number) => `€${x >= 100 ? Math.round(x).toLocaleString("en") : x.toFixed(2)}`;

export function DeckBoxesPanel({ deck }: { deck: Deck }) {
  const [rows, setRows] = useState<DeckBoxRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cards = [deck.commander, ...(deck.partner ? [deck.partner] : []), ...deck.cards]
      .filter((c) => !isBasicLand(c.name))
      .map((c) => ({ name: c.name, price: c.info?.priceEur ?? null }));
    let live = true;
    fetch("/api/ev/deck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cards }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => live && setRows(j.rows ?? []))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [deck]);

  if (failed || (rows && !rows.length)) return null;
  const best = rows?.[0];
  return (
    <div className="deckboxes" data-testid="deck-boxes">
      <span className="small-label">Singles or boxes?</span>
      {!best ? (
        <p className="fine">Looking up which booster boxes have this deck&apos;s cards…</p>
      ) : (
        <p className="deckboxes-best">
          The best box for this deck is <a href={`/ev/${best.product.id}`}>{best.product.name.replace(/ Booster$/, "")}</a>: {best.cards.length} of your cards can be in it, and one box gives you about <strong>{eur(best.deckValue)}</strong> of them. As singles, all {best.cards.length} cost <strong>{eur(best.singles)}</strong>, so singles are the cheaper way to finish the deck. <a href="/ev">Box EV</a>
        </p>
      )}
    </div>
  );
}

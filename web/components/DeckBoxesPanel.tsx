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
  return (
    <section className="panel deckboxes" data-testid="deck-boxes">
      <h3>Singles or boxes?</h3>
      {!rows ? (
        <p className="panel-sub">Looking up which booster boxes have this deck&apos;s cards…</p>
      ) : (
        <>
          <p className="panel-sub">The booster boxes that can give you the most of this deck. A card counts once: a second copy doesn&apos;t help a singleton deck.</p>
          <ul className="deckboxes-list">
            {rows.slice(0, 3).map((r) => (
              <li key={r.product.id}>
                <a href={`/ev/${r.product.id}`}>
                  <strong>
                    {r.product.name.replace(/ Booster$/, "")} box
                  </strong>
                </a>
                <span>
                  {r.cards.length} of your cards can be in it ({r.cards
                    .slice(0, 3)
                    .map((c) => c.name)
                    .join(", ")}
                  {r.cards.length > 3 ? ", …" : ""}). One box gives you about <strong>{eur(r.deckValue)}</strong> of them; all {r.cards.length} cost <strong>{eur(r.singles)}</strong> as singles. The whole box averages {eur(r.product.grossBox)} in cards.
                </span>
              </li>
            ))}
          </ul>
          <p className="opt-hint">For a finished deck, singles are almost always cheaper. Open boxes for the fun of it, or see what a box is worth in <a href="/ev">Box EV</a>.</p>
        </>
      )}
    </section>
  );
}

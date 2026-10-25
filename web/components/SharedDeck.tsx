"use client";
import { SiteHeader } from "./SiteHeader";
import { useEffect, useState } from "react";
import type { Deck, Validation } from "../lib/shared/types";
import { DeckView } from "./DeckView";

/** /deck?d=... : someone else's shared deck, rebuilt from the link with fresh Scryfall data. */
export default function SharedDeck({ d, missing }: { d: string; missing?: boolean }) {
  const [state, setState] = useState<{ deck: Deck; validation: Validation } | { error: string } | null>(null);

  useEffect(() => {
    if (!d) {
      setState({ error: missing ? "This deck link has expired or doesn't exist." : "This link doesn't contain a deck." });
      return;
    }
    fetch("/api/deck/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d }) })
      .then(async (r) => {
        const j = await r.json();
        setState(r.ok ? j : { error: j.error ?? "Couldn't load this deck." });
      })
      .catch(() => setState({ error: "Couldn't reach the server. Check your connection and reload." }));
  }, [d, missing]);

  return (
    <div className="app">
      <SiteHeader active={null} />
      <main>
        {!state ? <p className="loading">Loading the deck and its cards from Scryfall…</p> : null}
        {state && "error" in state ? (
          <div className="alert">
            <strong>{state.error}</strong>
            <p>
              Ask for a new link, or <a href="/">build your own deck</a>.
            </p>
          </div>
        ) : null}
        {state && "deck" in state ? <DeckView deck={state.deck} validation={state.validation} shareD={d} shared /> : null}
      </main>
      <footer className="foot">
        <p>
          Hundredfoldz is unofficial Fan Content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images via <a href="https://scryfall.com">Scryfall</a>. Free and open source: <a href="https://github.com/M-Sahin/mtg-master">built on the mtg-master Claude skill</a>.
        </p>
      </footer>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import type { Deck, Validation } from "../lib/shared/types";
import { DeckView } from "./DeckView";

/** /deck?d=... : someone else's shared deck, rebuilt from the link with fresh Scryfall data. */
export default function SharedDeck({ d }: { d: string }) {
  const [state, setState] = useState<{ deck: Deck; validation: Validation } | { error: string } | null>(null);

  useEffect(() => {
    if (!d) {
      setState({ error: "This link doesn't contain a deck." });
      return;
    }
    fetch("/api/deck/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d }) })
      .then(async (r) => {
        const j = await r.json();
        setState(r.ok ? j : { error: j.error ?? "Couldn't load this deck." });
      })
      .catch(() => setState({ error: "Couldn't reach the server. Check your connection and reload." }));
  }, [d]);

  return (
    <div className="app">
      <header className="top">
        <a className="wordmark" href="/" aria-label="Hundredfold home">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect x="5" y="4" width="16" height="22" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" transform="rotate(-10 13 15)" />
            <rect x="11" y="6" width="16" height="22" rx="2.5" fill="currentColor" opacity=".9" transform="rotate(8 19 17)" />
          </svg>{" "}
          Hundredfold
        </a>
        <a className="btn" href="/">
          Build your own deck
        </a>
      </header>
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
          Hundredfold is unofficial Fan Content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images via <a href="https://scryfall.com">Scryfall</a>. Free and open source: <a href="https://github.com/M-Sahin/mtg-master">built on the mtg-master Claude skill</a>.
        </p>
      </footer>
    </div>
  );
}

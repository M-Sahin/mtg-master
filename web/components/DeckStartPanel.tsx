"use client";
// "Start from your own deck": paste or upload a decklist. If it has fewer than 100 cards,
// ask whether Hundredfoldz should complete it; if it's complete, offer upgrade suggestions.
import { useState } from "react";
import type { BracketReport } from "../lib/server/bracket-check";
import { isBasicLand } from "../lib/shared/types";
import { useHumanCheck } from "./useHumanCheck";

export interface StartDeck {
  commander: string;
  partner?: string;
  cards: { name: string; qty: number }[];
  total: number;
  bracket: number;
}

export function DeckStartPanel({ onComplete, onUpgrade, onRead, blocked }: { onComplete: (d: StartDeck) => void; onUpgrade?: (d: StartDeck) => void; onRead?: (r: BracketReport) => void; blocked?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BracketReport | null>(null);
  const [declined, setDeclined] = useState(false);
  const human = useHumanCheck("bracket");

  const read = async (list: string) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setDeclined(false);
    try {
      const turnstile = await human.take();
      const r = await fetch("/api/bracket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ list, turnstile }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't read that list.");
      setReport(j);
      onRead?.(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const file = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) return setError("That file is too big for a decklist.");
    const t = await f.text();
    setText(t);
    void read(t);
  };

  const missing = report ? 100 - report.total : 0;
  const start = (r: BracketReport): StartDeck => ({ commander: r.commanders[0], partner: r.commanders[1], cards: r.cards, total: r.total, bracket: r.bracket });
  return (
    <section className="panel deckstart" aria-label="Start from your own deck">
      <div className="panel-head">
        <h3>Start from your own deck</h3>
        <span className="pill pill--quiet">optional</span>
      </div>
      {!open && !report ? (
        <p className="panel-sub">
          Half a deck already? Paste or upload it, and Hundredfoldz can complete it to 100 cards around what you have. A finished deck gets upgrade suggestions.{" "}
          <button type="button" className="link" onClick={() => setOpen(true)}>
            Add my deck
          </button>
        </p>
      ) : null}
      {open && !report ? (
        <div className="collection-input">
          <label className="btn">
            Upload a .txt file
            <input type="file" accept=".txt,text/plain" hidden data-testid="deck-file" onChange={(e) => file(e.target.files?.[0])} />
          </label>
          <textarea
            className="field"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n1 Viscera Seer\n…"}
            aria-label="Your decklist"
            data-testid="deck-list"
            spellCheck={false}
          />
          {human.widget}
          <button type="button" className="btn btn--brass" disabled={!text.trim() || busy} onClick={() => read(text)}>
            {busy ? "Reading…" : "Read my deck"}
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {report ? (
        <div className="deckstart-result" data-testid="deck-start-result">
          <p className="panel-sub">
            {report.commanders.length ? (
              <>
                <strong>{report.commanders.join(" + ")}</strong>: {report.total} of 100 cards, fits Bracket {report.bracket} ({report.name}) so far.
              </>
            ) : (
              <>We couldn&apos;t find the commander. Put it under a &ldquo;Commander&rdquo; heading (or first, followed by an empty line) and read the list again.</>
            )}
            {report.notFound.length ? ` Not found on Scryfall: ${report.notFound.join(", ")}.` : ""}
          </p>
          {report.commanders.length && missing > 0 && !declined ? (
            <div className="deckstart-ask">
              <p>
                <strong>Your deck has {report.total} cards. Do you want Hundredfoldz to complete it?</strong> Claude keeps every card you have and adds {missing} more, using the bracket, budget and wishes you set on this page.
              </p>
              <div className="deckstart-buttons">
                <button
                  type="button"
                  className="btn btn--brass"
                  disabled={!!blocked}
                  onClick={() => onComplete(start(report))}
                >
                  Yes, complete my deck
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setDeclined(true)}>
                  No thanks
                </button>
              </div>
              {blocked ? <p className="note">{blocked}</p> : null}
            </div>
          ) : null}
          {report.commanders.length && missing === 0 && onUpgrade && !declined ? (
            <div className="deckstart-ask">
              <p>
                <strong>Your deck is complete. Do you want Hundredfoldz to suggest upgrades?</strong> Claude keeps the plan and the commander, finds the weakest cards and suggests up to 10 swaps, each with a reason, for the bracket, budget and wishes you set on this page.
              </p>
              <div className="deckstart-buttons">
                <button type="button" className="btn btn--brass" disabled={!!blocked} onClick={() => onUpgrade(start(report))} data-testid="upgrade-deck">
                  Yes, suggest upgrades
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setDeclined(true)}>
                  No thanks
                </button>
              </div>
              {blocked ? <p className="note">{blocked}</p> : null}
            </div>
          ) : null}
          {report.commanders.length && missing === 0 && (!onUpgrade || declined) ? (
            <p className="panel-sub">
              Your deck is complete. <a href="/bracket">See the full bracket check</a>.
            </p>
          ) : null}
          {missing < 0 ? <p className="panel-sub">It has {report.total} cards: cut {-missing} to get to 100.</p> : null}
          <button
            type="button"
            className="link"
            onClick={() => {
              setReport(null);
              setOpen(true);
            }}
          >
            Use a different list
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Split a deck's cards into nonbasic names (all must stay) and basic land counts. */
export function splitBasics(cards: { name: string; qty: number }[]) {
  const names: string[] = [];
  const basics: Record<string, number> = {};
  for (const c of cards) {
    if (isBasicLand(c.name)) basics[c.name] = (basics[c.name] ?? 0) + c.qty;
    else names.push(c.name);
  }
  return { names, basics };
}

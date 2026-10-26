"use client";
// /bracket: paste a decklist, see the lowest Commander bracket it fits and why. No AI, no key.
import { useState } from "react";
import type { BracketReport } from "../lib/server/bracket-check";
import { OpenersView } from "./OpenersView";
import { SiteHeader } from "./SiteHeader";
import { useHumanCheck } from "./useHumanCheck";

const EXAMPLE = "Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n1 Sakura-Tribe Elder\n1 Viscera Seer\n…";

export default function BracketChecker() {
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BracketReport | null>(null);
  const human = useHumanCheck("bracket");

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const turnstile = await human.take();
      const r = await fetch("/api/bracket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ list, turnstile }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The check failed.");
      setReport(j);
      setTimeout(() => document.getElementById("bracket-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const t = report?.analysis?.template;
  return (
    <div className="app">
      <SiteHeader active="bracket" />
      <main className="bracket-page">
        <section className="hero">
          <h1>Which bracket is my deck?</h1>
          <p className="hero-sub">Paste any Commander decklist. You get the lowest bracket it fits, every card that decides it, and a quick legality check. Free, no account and no API key needed.</p>
        </section>

        <section className="panel">
          <label className="opt">
            <span className="opt-label">Your decklist</span>
            <textarea className="field bracket-input" rows={12} value={list} onChange={(e) => setList(e.target.value)} placeholder={EXAMPLE} aria-label="Decklist" data-testid="bracket-list" spellCheck={false} />
            <span className="opt-hint">Works with exports from Moxfield, Archidekt, MTG Arena and MTGO, or any &ldquo;1 Card name&rdquo; list. Put the commander under a &ldquo;Commander&rdquo; heading, or first, followed by an empty line.</span>
          </label>
          <div className="bracket-actions">
            {human.widget}
            <button type="button" className="btn btn--big btn--brass" onClick={check} disabled={busy || !list.trim() || !human.ready}>
              {busy ? "Checking…" : human.ready ? "Check the bracket" : "One moment…"}
            </button>
            <label className="btn">
              Upload a .txt file
              <input
                type="file"
                accept=".txt,text/plain"
                hidden
                data-testid="bracket-file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 200_000) return setError("That file is too big for a decklist.");
                  setError(null);
                  setList(await f.text());
                }}
              />
            </label>
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        {report ? (
          <section id="bracket-result" className="bracket-result" aria-live="polite">
            <div className={`bracket-badge bracket-badge--${report.bracket}`}>
              <span className="bracket-num">{report.bracket}</span>
              <span>
                <strong>Bracket {report.bracket}: {report.name}</strong>
                <span className="bracket-turns">
                  {report.bracket === 2 ? "Or bracket 1 (Exhibition) if it's a themed deck built to stay low-powered. " : ""}
                  {report.bracket === 4 ? "Or bracket 5 (cEDH) if it's tuned to win as fast as possible. " : ""}
                  Games at this bracket usually last {report.turns}.
                </span>
              </span>
            </div>

            <div className="panel">
              <h3>Why</h3>
              {report.reasons.length ? (
                <ul className="bracket-reasons">
                  {report.reasons.map((r, i) => (
                    <li key={i}>
                      <span className="pill">B{r.bracket}+</span> {r.text}
                      {r.cards?.length ? <span className="bracket-cards">{r.cards.join(" · ")}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel-sub">No Game Changers, two-card combos, mass land denial or extra turns: nothing pushes this deck above bracket 2.</p>
              )}
              {report.combos.checked ? null : <p className="note">The combo check (Commander Spellbook) didn't answer, so combos weren't checked.</p>}
              {report.combos.early.length + report.combos.other.length ? (
                <p className="note">
                  Combo details on Commander Spellbook:{" "}
                  {[...report.combos.early, ...report.combos.other].map((c, i) => (
                    <span key={c.id}>
                      {i ? ", " : ""}
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        {c.cards.join(" + ")}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>

            <div className="panel">
              <h3>The deck</h3>
              <p className="panel-sub">
                {report.commanders.length ? (
                  <>
                    Commander: <strong>{report.commanders.join(" + ")}</strong>
                    {report.commanderGuessed ? " (worked out from the list)" : ""}.{" "}
                  </>
                ) : null}
                {report.total} cards.
                {t ? ` Lands ${t.lands.have}, ramp ${t.ramp.have}, card draw ${t.draw.have}, removal ${t.removal.have}, board wipes ${t.wipe.have} (counted from the card text).` : ""}
              </p>
              {report.problems.length ? (
                <ul className="bracket-problems">
                  {report.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="panel-sub">Legal for Commander: 100 cards, singleton, every card in the commander&apos;s colors and not banned.</p>
              )}
              {report.notFound.length ? <p className="note">Not found on Scryfall (check the spelling): {report.notFound.join(", ")}.</p> : null}
            </div>

            {report.openers ? <OpenersView report={report.openers} /> : null}

            <p className="note">
              This is an estimate from the official bracket guidelines. Brackets are also about intent, so talk it over with your table. Game Changers come from Scryfall and combos from{" "}
              <a href="https://commanderspellbook.com" target="_blank" rel="noopener noreferrer">
                Commander Spellbook
              </a>
              .
            </p>
          </section>
        ) : null}
      </main>
      <footer className="foot">
        <p>
          Hundredfoldz is unofficial Fan Content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data via <a href="https://scryfall.com">Scryfall</a>, combos via <a href="https://commanderspellbook.com">Commander Spellbook</a>.
        </p>
      </footer>
    </div>
  );
}

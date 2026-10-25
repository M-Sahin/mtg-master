"use client";
// Box EV: every supported booster box with its average card value, filterable and sortable.
import { useMemo, useState } from "react";
import { KIND_LABEL, type EvKind } from "../lib/shared/ev";
import type { EvIndex } from "../lib/server/ev-data";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

type Sort = "new" | "gross" | "net";
const KINDS: (EvKind | "all")[] = ["all", "play", "collector", "set", "draft"];
const eur = (x: number) => `€${Math.round(x).toLocaleString("en")}`;

export default function EvIndexView({ index, error }: { index: EvIndex | null; error: string | null }) {
  const [kind, setKind] = useState<EvKind | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (index?.products ?? []).filter((p) => (kind === "all" || p.kind === kind) && (!t || p.setName.toLowerCase().includes(t) || p.set === t));
    if (sort === "gross") return [...list].sort((a, b) => b.grossBox - a.grossBox);
    if (sort === "net") return [...list].sort((a, b) => b.netBox - a.netBox);
    return list;
  }, [index, kind, q, sort]);
  const date = index ? new Date(index.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

  return (
    <div className="app">
      <SiteHeader active="ev" />
      <main className="ev-page">
        <section className="hero">
          <h1>What&apos;s a booster box worth?</h1>
          <p className="hero-sub">
            The average value of the cards in every booster box since 2020, worked out from the published pack odds and today&apos;s Cardmarket prices. Open a box to put in your price and see your chance of getting it back. Free, no account.
          </p>
        </section>
        {error ? <p className="error">{error}</p> : null}
        {index ? (
          <>
            <div className="ev-controls">
              <div className="seg seg--five" role="radiogroup" aria-label="Booster type">
                {KINDS.map((k) => (
                  <label key={k} className={`seg-item ${kind === k ? "is-on" : ""}`}>
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                    {k === "all" ? "All" : KIND_LABEL[k].replace(" Booster", "")}
                  </label>
                ))}
              </div>
              <input className="field ev-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a set" aria-label="Search a set" />
              <label className="ev-sort">
                <span>Sort</span>
                <select className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="new">Newest first</option>
                  <option value="gross">Highest EV</option>
                  <option value="net">Highest net EV</option>
                </select>
              </label>
            </div>
            <div className="ev-table" role="table" aria-label="Booster boxes" data-testid="ev-table">
              <div className="ev-row ev-row--head" role="row">
                <span role="columnheader">Box</span>
                <span role="columnheader">Released</span>
                <span role="columnheader" className="num">
                  EV per box
                </span>
                <span role="columnheader" className="num">
                  After selling
                </span>
                <span role="columnheader">Most valuable pull</span>
              </div>
              {rows.map((p) => (
                <a key={p.id} className="ev-row" role="row" href={`/ev/${p.id}`}>
                  <span className="ev-name" role="cell">
                    {p.icon ? <img src={p.icon} alt="" width={22} height={22} className="ev-icon" /> : null}
                    <span>
                      <strong>{p.setName}</strong>
                      <small>
                        {KIND_LABEL[p.kind]} box · {p.packsPerBox} packs
                        {p.unpriced >= 0.1 ? <span className="ev-warn"> · {Math.round(p.unpriced * 100)}% of cards unpriced</span> : null}
                      </small>
                    </span>
                  </span>
                  <span role="cell" className="ev-date">
                    {p.released}
                  </span>
                  <span role="cell" className="num ev-gross">
                    {eur(p.grossBox)}
                  </span>
                  <span role="cell" className="num ev-net">
                    {eur(p.netBox)}
                  </span>
                  <span role="cell" className="ev-top">
                    {p.topCard ?? ""}
                  </span>
                </a>
              ))}
              {!rows.length ? <p className="panel-sub">No boxes match.</p> : null}
            </div>
            <p className="note">
              EV per box: every card at its Cardmarket trend price. After selling: 5% marketplace fee, and cards under €1 count as €0 because they&apos;re not worth selling one by one. Prices from{" "}
              <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
                Scryfall
              </a>{" "}
              ({date}); pack odds from{" "}
              <a href="https://github.com/taw/magic-sealed-data" target="_blank" rel="noopener noreferrer">
                magic-sealed-data
              </a>
              , the source MTGJSON uses. EV is an average: most boxes are worth less, a few much more.
            </p>
          </>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}

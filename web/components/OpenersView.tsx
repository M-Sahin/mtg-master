"use client";
// The opening-hand check as a panel: shares of goldfished games where the mana arrives on time.
import { openerProblems, type OpenerReport } from "../lib/shared/openers";
import type { Color } from "../lib/shared/types";

const COLOR_NAMES: Record<Color, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

export function OpenersView({ report: r }: { report: OpenerReport }) {
  const problems = openerProblems(r);
  const rows: [string, number, number][] = [
    ["Keep the first 7", r.keep7, 0.5],
    ["Keep after the free mulligan", r.keep7 + r.freeMulligan, 0.8],
    ["Third land on turn 3", r.landDrop3, 0.75],
    ["Fourth land on turn 4", r.landDrop4, 0.55],
    ...r.commanders.filter((c) => c.mv <= 7).map((c): [string, number, number] => [`${c.name.split(",")[0]} by turn ${Math.min(c.mv + 1, 8)}`, c.oneLate, 0.5]),
    ...(r.colorByTurn3.length > 1 ? r.colorByTurn3.map((c): [string, number, number] => [`${COLOR_NAMES[c.color]} mana by turn 3`, c.share, 0.7]) : []),
  ];
  return (
    <section className="panel" data-testid="openers">
      <h3>Opening hands</h3>
      <p className="panel-sub">
        {r.games.toLocaleString("en")} goldfished games: Commander mulligans (the first is free), a land a turn, cheap ramp, and the commander as soon as the mana allows. An estimate of how the mana works, not of how the deck plays.
      </p>
      <div className="openers">
        {rows.map(([label, share, ok]) => (
          <div key={label} className="op-row">
            <span className="op-label" title={label}>{label}</span>
            <span className="op-track">
              <span className={`op-bar ${share >= ok ? "is-ok" : "is-low"}`} style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
            <span className="op-n">{Math.round(share * 100)}%</span>
          </div>
        ))}
      </div>
      {problems.length ? (
        <ul className="op-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : (
        <p className="panel-sub op-ok">The mana looks healthy. It floods (7+ lands in the first 14 cards) in {Math.round(r.flood * 100)}% of games.</p>
      )}
    </section>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { BRACKET, COMMANDER_TEMPLATE } from "../lib/shared/bracket";
import { MANA_COLORS, ROLE_COLORS, averageMv, byRole, byType, curve, exportText, library, pips, price, shuffle, totalCards, isLand } from "../lib/shared/deck-utils";
import type { Color, Deck, DeckCard, Validation } from "../lib/shared/types";
import { ROLE_LABELS } from "../lib/shared/types";
import { CardFace, IdentityPips, ManaCost } from "./CardFace";
import { ShareButton } from "./ShareSheet";

type Tab = "cards" | "list" | "numbers" | "hand";

export function DeckView({
  deck,
  validation,
  onRestart,
  onRebuild,
  shared = false,
  shareD,
}: {
  deck: Deck;
  validation: Validation;
  onRestart?: () => void;
  onRebuild?: () => void;
  shared?: boolean; // viewing someone else's deck from a share link
  shareD?: string; // the link payload, when we already have it
}) {
  const [tab, setTab] = useState<Tab>("cards");
  const [open, setOpen] = useState<DeckCard | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const cmd = deck.commander;

  const copy = async (style: "moxfield" | "arena") => {
    try {
      await navigator.clipboard.writeText(exportText(deck, style));
      setCopied(style);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied("error");
    }
  };
  const download = () => {
    const blob = new Blob([exportText(deck)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${deck.name.replace(/[^\w\- ]+/g, "").trim() || "deck"}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="deck">
      <header className="deck-banner" style={{ ["--art" as string]: cmd.info?.artCrop && cmd.info.artist ? `url("${cmd.info.artCrop}")` : "none" }}>
        <div className="deck-banner-inner">
          <CardFace card={cmd.info} name={cmd.name} tilt className="deck-cmd" onClick={() => setOpen(cmd)} loading="eager" />
          <div className="deck-title">
            <p className="deck-kicker">
              <IdentityPips colors={deck.colorIdentity} /> {shared ? "Shared with you: a " : ""}
              {shared ? "b" : "B"}racket {BRACKET.number} Commander deck led by {cmd.name}
              {deck.partner ? ` and ${deck.partner.name}` : ""}
            </p>
            <h2>{deck.name}</h2>
            <p className="deck-strategy">{deck.strategy}</p>
            <div className="deck-actions">
              <ShareButton deck={deck} shareD={shareD} />
              <button type="button" className="btn" onClick={() => copy("moxfield")}>
                {copied === "moxfield" ? "Copied" : "Copy list"}
              </button>
              <button type="button" className="btn" onClick={() => copy("arena")}>
                {copied === "arena" ? "Copied" : "Copy for Arena"}
              </button>
              <button type="button" className="btn" onClick={download}>
                Download .txt
              </button>
              {onRebuild ? (
                <button type="button" className="btn btn--quiet" onClick={onRebuild}>
                  Build another version
                </button>
              ) : null}
              {onRestart ? (
                <button type="button" className="btn btn--quiet" onClick={onRestart}>
                  New seeds
                </button>
              ) : null}
            </div>
            {copied === "error" ? <p className="note">Your browser blocked the clipboard. Use Download instead.</p> : null}
          </div>
        </div>
        {cmd.info?.artCrop && cmd.info.artist ? (
          <p className="deck-art-credit">
            Background: {cmd.info.name}, art by {cmd.info.artist}. © Wizards of the Coast
          </p>
        ) : null}
      </header>

      {!validation.ok ? (
        <div className="alert">
          <strong>This list still has problems Claude couldn't fix:</strong>
          <ul>
            {validation.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="deck-body">
        <aside className="deck-side">
          <h3>How it wins</h3>
          <ol className="wincons">
            {deck.winConditions.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ol>
          <BracketCard deck={deck} validation={validation} />
        </aside>

        <div className="deck-main">
          <div className="tabs" role="tablist" aria-label="Deck views">
            {(
              [
                ["cards", "Cards"],
                ["list", "List"],
                ["numbers", "Numbers"],
                ["hand", "Draw a hand"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} className={`tab ${tab === t ? "is-on" : ""}`} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
            <span className="tabs-total">{totalCards(deck)} cards</span>
          </div>
          {tab === "cards" ? <CardsTab deck={deck} onOpen={setOpen} /> : null}
          {tab === "list" ? <ListTab deck={deck} onOpen={setOpen} /> : null}
          {tab === "numbers" ? <NumbersTab deck={deck} /> : null}
          {tab === "hand" ? <HandTab deck={deck} onOpen={setOpen} /> : null}
        </div>
      </div>
      {open ? <CardModal card={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function CardsTab({ deck, onOpen }: { deck: Deck; onOpen: (c: DeckCard) => void }) {
  return (
    <div className="roles">
      {byRole(deck).map((g) => (
        <section key={g.role} className="role" style={{ ["--role" as string]: ROLE_COLORS[g.role] }}>
          <h3 className="role-title">
            {ROLE_LABELS[g.role]} <span className="role-count">{g.count}</span>
          </h3>
          <div className="role-grid">
            {g.cards.map((c) => (
              <div key={c.name} className="tile">
                <CardFace card={c.info} name={c.name} onClick={() => onOpen(c)} />
                {c.qty > 1 ? <span className="tile-qty">×{c.qty}</span> : null}
                {c.seed ? <span className="tile-seed" title="One of your seed cards">Seed</span> : null}
                {c.info?.gameChanger ? <span className="tile-gc" title="Game Changer">GC</span> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ListTab({ deck, onOpen }: { deck: Deck; onOpen: (c: DeckCard) => void }) {
  return (
    <div className="list">
      {byType(deck).map((g) => (
        <section key={g.type} className="list-group">
          <h3>
            {g.type === "Other" ? "Other" : g.type === "Sorcery" ? "Sorceries" : `${g.type}s`} <span className="role-count">{g.count}</span>
          </h3>
          <ul>
            {g.cards.map((c) => (
              <li key={c.name}>
                <button type="button" className="list-row" onClick={() => onOpen(c)}>
                  <span className="list-qty">{c.qty}</span>
                  <span className="list-name">{c.name}</span>
                  <span className="list-role" style={{ color: ROLE_COLORS[c.role] }}>
                    {ROLE_LABELS[c.role]}
                  </span>
                  <ManaCost cost={c.info?.manaCost ?? ""} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NumbersTab({ deck }: { deck: Deck }) {
  const cv = curve(deck);
  const max = Math.max(...cv, 1);
  const roles = byRole(deck);
  const roleCount = (r: string) => roles.find((g) => g.role === r)?.count ?? 0;
  const p = pips(deck);
  const pipTotal = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  const cost = price(deck);
  const lands = deck.cards.filter(isLand).reduce((n, c) => n + c.qty, 0);
  const rows: [string, number, readonly [number, number]][] = [
    ["Lands", lands, COMMANDER_TEMPLATE.lands],
    ["Ramp", roleCount("ramp"), COMMANDER_TEMPLATE.ramp],
    ["Card draw", roleCount("draw"), COMMANDER_TEMPLATE.draw],
    ["Removal", roleCount("removal"), COMMANDER_TEMPLATE.removal],
    ["Board wipes", roleCount("wipe"), COMMANDER_TEMPLATE.wipe],
    ["Protection", roleCount("protection"), COMMANDER_TEMPLATE.protection],
  ];
  return (
    <div className="numbers">
      <section className="panel">
        <h3>Mana curve</h3>
        <p className="panel-sub">Nonland cards by mana value. Average {averageMv(deck).toFixed(2)}.</p>
        <div className="curve" role="img" aria-label={`Mana curve: ${cv.map((n, i) => `${i === 7 ? "7+" : i}: ${n}`).join(", ")}`}>
          {cv.map((n, i) => (
            <div key={i} className="curve-col">
              <span className="curve-n">{n || ""}</span>
              <span className="curve-bar" style={{ height: `${(n / max) * 100}%` }} />
              <span className="curve-x">{i === 7 ? "7+" : i}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Against the Commander template</h3>
        <p className="panel-sub">The skill's starting point for brackets 2–3. The shaded band is the target range.</p>
        <div className="template">
          {rows.map(([label, n, [lo, hi]]) => {
            const scale = 40;
            const inRange = n >= lo && n <= hi;
            return (
              <div key={label} className="tpl-row">
                <span className="tpl-label">{label}</span>
                <span className="tpl-track">
                  <span className="tpl-band" style={{ left: `${(lo / scale) * 100}%`, width: `${((hi - lo) / scale) * 100}%` }} />
                  <span className={`tpl-dot ${inRange ? "is-in" : ""}`} style={{ left: `${(Math.min(n, scale) / scale) * 100}%` }} />
                </span>
                <span className="tpl-n">
                  {n} <small>({lo}–{hi})</small>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h3>Color demand</h3>
        <p className="panel-sub">Colored mana symbols in costs.</p>
        <div className="pipbar">
          {(Object.keys(p) as Color[])
            .filter((c) => p[c] > 0)
            .map((c) => (
              <span key={c} style={{ flexGrow: p[c], background: MANA_COLORS[c] }} title={`${c}: ${p[c]}`}>
                {Math.round((p[c] / pipTotal) * 100)}%
              </span>
            ))}
        </div>
      </section>
      <section className="panel">
        <h3>Price</h3>
        <p className="panel-big">€{cost.eur.toFixed(0)}</p>
        <p className="panel-sub">Cardmarket trend prices from Scryfall, basics excluded{cost.missing ? `; ${cost.missing} card${cost.missing === 1 ? "" : "s"} without a price` : ""}. Prices change daily.</p>
      </section>
    </div>
  );
}

function HandTab({ deck, onOpen }: { deck: Deck; onOpen: (c: DeckCard) => void }) {
  const lib = useMemo(() => library(deck), [deck]);
  const [order, setOrder] = useState(() => shuffle(lib));
  const [drawn, setDrawn] = useState(7);
  const [deal, setDeal] = useState(0);
  const hand = order.slice(0, drawn);
  const lands = hand.filter(isLand).length;
  const newHand = () => {
    setOrder(shuffle(lib));
    setDrawn(7);
    setDeal((d) => d + 1);
  };
  return (
    <div className="handtab">
      <div className="handtab-bar">
        <button type="button" className="btn btn--brass" onClick={newHand}>
          Draw a new hand
        </button>
        <button type="button" className="btn" onClick={() => setDrawn((d) => Math.min(d + 1, lib.length))}>
          Draw a card
        </button>
        <span className="handtab-info">
          {hand.length} cards, {lands} land{lands === 1 ? "" : "s"}
          {drawn === 7 ? (lands >= 3 && lands <= 4 ? ". A keep." : lands < 2 ? ". Too few lands; mulligan." : lands > 5 ? ". Too many lands; consider a mulligan." : ".") : ""}
        </span>
      </div>
      <div className="dealt" key={deal}>
        {hand.map((c, i) => (
          <div key={`${deal}-${i}`} className="dealt-card" style={{ ["--n" as string]: i }}>
            <CardFace card={c.info} name={c.name} tilt onClick={() => onOpen(c)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketCard({ deck, validation }: { deck: Deck; validation: Validation }) {
  const gc = validation.gameChangers;
  const mldWarn = validation.warnings.find((w) => w.includes("mass land denial"));
  const turnWarn = validation.warnings.find((w) => w.includes("extra-turn"));
  const items: [boolean, string][] = [
    [gc.length <= BRACKET.maxGameChangers, `${gc.length} of ${BRACKET.maxGameChangers} Game Changers${gc.length ? `: ${gc.join(", ")}` : ""}`],
    [!mldWarn, mldWarn ? mldWarn : "No mass land denial"],
    [!turnWarn, turnWarn ? turnWarn : "No chained extra turns"],
    [validation.total === 100, `${validation.total} cards, singleton, all in color identity`],
  ];
  return (
    <div className="bracket">
      <h3>Bracket {BRACKET.number} check</h3>
      <ul>
        {items.map(([ok, text]) => (
          <li key={text} className={ok ? "is-ok" : "is-warn"}>
            <span aria-hidden>{ok ? "✓" : "!"}</span> {text}
          </li>
        ))}
      </ul>
      {deck.bracketNotes ? <p className="bracket-note">{deck.bracketNotes}</p> : null}
      {validation.warnings.filter((w) => w !== mldWarn && w !== turnWarn).length ? (
        <details className="bracket-more">
          <summary>Notes from the deck check</summary>
          <ul>
            {validation.warnings
              .filter((w) => w !== mldWarn && w !== turnWarn)
              .map((w) => (
                <li key={w}>{w}</li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function CardModal({ card, onClose }: { card: DeckCard; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const i = card.info;
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={card.name}>
      <div className="modal-inner">
        <CardFace card={i} name={card.name} tilt className="modal-card" loading="eager" />
        <div className="modal-text">
          <h3>
            {card.name} <ManaCost cost={i?.manaCost ?? ""} />
          </h3>
          <p className="modal-type">{i?.typeLine}</p>
          {i?.oracleText ? <p className="modal-oracle">{i.oracleText}</p> : null}
          <p className="modal-why" style={{ ["--role" as string]: ROLE_COLORS[card.role] }}>
            <span className="modal-role">{card.why === "Commander" ? "Commander" : ROLE_LABELS[card.role]}</span>
            {card.why && card.why !== "Commander" ? card.why : null}
          </p>
          <p className="modal-meta">
            {i?.priceEur != null ? `€${i.priceEur.toFixed(2)}` : "No price"}
            {i?.gameChanger ? ", Game Changer" : ""}
            {card.seed ? ", one of your seeds" : ""}
          </p>
          <div className="modal-actions">
            {i?.scryfallUri ? (
              <a className="btn" href={i.scryfallUri} target="_blank" rel="noreferrer">
                Open on Scryfall
              </a>
            ) : null}
            <button type="button" className="btn btn--quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

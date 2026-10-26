"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COMMANDER_TEMPLATE, bracketInfo } from "../lib/shared/bracket";
import { MANA_COLORS, ROLE_COLORS, averageMv, byRole, byType, curve, exportText, library, pips, price, shuffle, totalCards, isLand } from "../lib/shared/deck-utils";
import type { Color, Deck, DeckCard, Validation } from "../lib/shared/types";
import { ROLE_LABELS, isBasicLand } from "../lib/shared/types";
import { simulateOpeners, type OpenerReport } from "../lib/shared/openers";
import { checkShape, shapeCounts } from "../lib/shared/shape";
import { analyzeDeck } from "../lib/shared/analysis";
import { OpenersView } from "./OpenersView";
import { DeckBoxesPanel } from "./DeckBoxesPanel";
import { BuyLinks } from "./BuyLinks";
import { CardOffers } from "./CardOffers";
import { buyDeckLinks, cartLines } from "../lib/shared/buy";
import { useSiteConfig } from "../lib/client/site-config";
import { CardFace, IdentityPips, ManaCost } from "./CardFace";
import { ShareButton } from "./ShareSheet";
import { Menu } from "./Menu";

type Tab = "cards" | "list" | "numbers" | "hand";
type CardsView = "stacks" | "grid";

export function DeckView({
  deck,
  validation,
  onRestart,
  onRebuild,
  shared = false,
  shareD,
  spend,
  donationUrl,
  added,
  saveSlot,
}: {
  deck: Deck;
  validation: Validation;
  onRestart?: () => void;
  onRebuild?: () => void;
  shared?: boolean; // viewing someone else's deck from a share link
  shareD?: string; // the link payload, when we already have it
  spend?: string; // model, tokens and estimated cost of this build
  donationUrl?: string;
  /** Upgrade mode: cards Claude swapped in, marked "New". */
  added?: string[];
  /** The save button (or "Saved") next to Share; the page decides what it does. */
  saveSlot?: ReactNode;
}) {
  const [buying, setBuying] = useState(false);
  const site = useSiteConfig();
  const addedSet = useMemo(() => (added?.length ? new Set(added.map((n) => n.toLowerCase())) : undefined), [added]);
  const [tab, setTab] = useState<Tab>("cards");
  // every deck opens in the grid; stacks are a choice for this deck
  const [view, setView] = useState<CardsView>("grid");
  const pickView = (v: CardsView) => setView(v);
  const [open, setOpen] = useState<DeckCard | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const cmd = deck.commander;
  // goldfished opening hands, worked out in the browser (no API calls): once, for the stats and the Numbers tab
  const openers = useMemo(() => (deck.cards.some((c) => c.info) ? simulateOpeners(deck) : null), [deck]);

  const copy = async (style: "moxfield" | "arena") => {
    try {
      await navigator.clipboard.writeText(exportText(deck, style));
      setCopied(style);
      setTimeout(() => setCopied(null), 2500);
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
              {shared ? "b" : "B"}racket {deck.bracket ?? 3} Commander deck led by {cmd.name}
              {deck.partner ? ` and ${deck.partner.name}` : ""}
            </p>
            <h2>{deck.name}</h2>
            <p className="deck-strategy">{deck.strategy}</p>
            <DeckStats deck={deck} validation={validation} openers={openers} />
            <div className="deck-actions">
              <ShareButton deck={deck} shareD={shareD} />
              {saveSlot}
              <button type="button" className={`btn ${buying ? "is-on" : ""}`} onClick={() => setBuying((b) => !b)} aria-expanded={buying} data-testid="buy-toggle">
                Buy the cards
              </button>
              <Menu
                label="Export"
                testId="export-menu"
                items={[
                  { label: "Copy list (Moxfield, Archidekt)", onClick: () => void copy("moxfield"), testId: "copy-list" },
                  { label: "Copy for MTG Arena", onClick: () => void copy("arena"), testId: "copy-arena" },
                  { label: "Download .txt", onClick: download, testId: "download-txt" },
                ]}
              />
              <Menu
                label="More"
                className="btn btn--quiet"
                testId="more-menu"
                items={[...(onRebuild ? [{ label: "Build another version", onClick: onRebuild, testId: "rebuild" }] : []), ...(onRestart ? [{ label: "Start over with new seeds", onClick: onRestart, testId: "new-seeds" }] : [])]}
              />
            </div>
            {copied ? (
              <p className="note" role="status">
                {copied === "error" ? "Your browser blocked the clipboard. Use Download instead." : "Copied. Paste it into your deckbuilder."}
              </p>
            ) : null}
            {buying ? <BuyLinks links={buyDeckLinks(deck, site?.affiliates)} copyText={cartLines(deck).join("\n")} note={`${cartLines(deck).length} cards, basic lands left out. Each shop opens with the list filled in, so you can pick printings and see the total there.`} /> : null}
            {spend ? (
              <p className="deck-spend">
                {spend}.
                {donationUrl ? (
                  <>
                    {" "}
                    Hundredfoldz is free;{" "}
                    <a href={donationUrl} target="_blank" rel="noopener noreferrer">
                      buy the maker a coffee
                    </a>{" "}
                    if you like it.
                  </>
                ) : null}
              </p>
            ) : null}
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
          {deck.shape ? <ShapeCard deck={deck} /> : null}
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
            {tab === "cards" ? (
              <span className="viewswitch" role="group" aria-label="Card layout">
                {(
                  [
                    ["grid", "Grid"],
                    ["stacks", "Stacks"],
                  ] as [CardsView, string][]
                ).map(([v, label]) => (
                  <button key={v} type="button" className={`viewswitch-btn ${view === v ? "is-on" : ""}`} aria-pressed={view === v} onClick={() => pickView(v)} data-testid={`view-${v}`}>
                    {label}
                  </button>
                ))}
              </span>
            ) : null}
            <span className="tabs-total">{totalCards(deck)} cards</span>
          </div>
          {tab === "cards" ? <CardsTab deck={deck} onOpen={setOpen} added={addedSet} view={view} /> : null}
          {tab === "list" ? <ListTab deck={deck} onOpen={setOpen} /> : null}
          {tab === "numbers" ? <NumbersTab deck={deck} openers={openers} /> : null}
          {tab === "hand" ? <HandTab deck={deck} onOpen={setOpen} /> : null}
        </div>
      </div>
      {open ? <CardModal card={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

/** The user's deck-shape limits against the counts from the card text. */
function ShapeCard({ deck }: { deck: Deck }) {
  const checks = useMemo(() => checkShape(deck.shape, shapeCounts(deck, analyzeDeck(deck))), [deck]);
  if (!checks.length) return null;
  return (
    <div className="bracket" data-testid="shape-card">
      <h3>Your deck shape</h3>
      <ul>
        {checks.map((c) => (
          <li key={c.key} className={c.ok ? "is-ok" : "is-warn"}>
            <span aria-hidden>{c.ok ? "✓" : "!"}</span> {c.label}: {c.have} <small>(you asked for {c.want})</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Badges({ c, added }: { c: DeckCard; added?: Set<string> }) {
  return (
    <>
      {c.qty > 1 ? <span className="tile-qty">×{c.qty}</span> : null}
      {c.seed ? <span className="tile-seed" title="One of your seed cards">Seed</span> : null}
      {added?.has(c.name.toLowerCase()) ? <span className="tile-seed tile-new" title="Swapped in by the upgrade">New</span> : null}
      {c.info?.gameChanger ? <span className="tile-gc" title="Game Changer">GC</span> : null}
    </>
  );
}

function CardsTab({ deck, onOpen, added, view }: { deck: Deck; onOpen: (c: DeckCard) => void; added?: Set<string>; view: CardsView }) {
  if (view === "stacks") return <Stacks deck={deck} onOpen={onOpen} added={added} />;
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
                <Badges c={c} added={added} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Stacks: one overlapping column per role. A tap (or a key) pops a card out of its stack, so the
 * whole card shows; a second tap opens it. With a mouse, hovering already shows the card, so a
 * click opens it straight away.
 */
function Stacks({ deck, onOpen, added }: { deck: Deck; onOpen: (c: DeckCard) => void; added?: Set<string> }) {
  const [peek, setPeek] = useState<string | null>(null);
  useEffect(() => {
    if (!peek) return;
    const away = (e: PointerEvent) => !(e.target as HTMLElement).closest?.(".stack-card") && setPeek(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPeek(null);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [peek]);
  const click = (c: DeckCard, e: { nativeEvent: Event }) => {
    const mouse = (e.nativeEvent as PointerEvent).pointerType === "mouse";
    if (mouse || peek === c.name) {
      setPeek(null);
      onOpen(c);
    } else setPeek(c.name);
  };
  return (
    <div className="stacks" data-testid="stacks">
        {byRole(deck).map((g) => (
          <section key={g.role} className="stack-col" style={{ ["--role" as string]: ROLE_COLORS[g.role] }}>
            <h3 className="role-title">
              {ROLE_LABELS[g.role]} <span className="role-count">{g.count}</span>
            </h3>
            <div className="stack">
              {g.cards.map((c) => (
                <div key={c.name} className={`tile stack-card ${peek === c.name ? "is-peek" : ""}`} data-testid="stack-card">
                  <CardFace card={c.info} name={c.name} onClick={(e) => click(c, e)} />
                  <span className="stack-badges">
                    <Badges c={c} added={added} />
                  </span>
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

function curveVerdict(avg: number) {
  return avg < 2.6 ? "a low, fast curve" : avg <= 3.3 ? "a typical curve" : "on the heavy side";
}

function NumbersTab({ deck, openers }: { deck: Deck; openers: OpenerReport | null }) {
  const cv = curve(deck);
  const max = Math.max(...cv, 1);
  const roles = byRole(deck);
  const roleCount = (r: string) => roles.find((g) => g.role === r)?.count ?? 0;
  const p = pips(deck);
  const pipTotal = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  const cost = price(deck);
  const avg = averageMv(deck);
  const lands = deck.cards.filter(isLand).reduce((n, c) => n + c.qty, 0);
  const rows: [string, number, readonly [number, number]][] = [
    ["Lands", lands, COMMANDER_TEMPLATE.lands],
    ["Ramp", roleCount("ramp"), COMMANDER_TEMPLATE.ramp],
    ["Card draw", roleCount("draw"), COMMANDER_TEMPLATE.draw],
    ["Removal", roleCount("removal"), COMMANDER_TEMPLATE.removal],
    ["Board wipes", roleCount("wipe"), COMMANDER_TEMPLATE.wipe],
    ["Protection", roleCount("protection"), COMMANDER_TEMPLATE.protection],
  ];
  const low = rows.filter(([, n, [lo]]) => n < lo).map(([l]) => l.toLowerCase());
  const high = rows.filter(([, n, [, hi]]) => n > hi).map(([l]) => l.toLowerCase());
  const balance = !low.length && !high.length ? "Every count is in the usual range." : [low.length ? `${sentence(low)} ${low.length === 1 ? "is" : "are"} below the usual range` : "", high.length ? `${sentence(high, !low.length)} ${high.length === 1 ? "is" : "are"} above it` : ""].filter(Boolean).join("; ") + ".";
  const colors = (Object.keys(p) as Color[]).filter((c) => p[c] > 0);
  return (
    <div className="numbers">
      <section className="panel">
        <h3>Mana curve</h3>
        <p className="verdict">
          Average mana value {avg.toFixed(2)}: {curveVerdict(avg)}.
        </p>
        <div className="curve" role="img" aria-label={`Mana curve: ${cv.map((n, i) => `${i === 7 ? "7+" : i}: ${n}`).join(", ")}`}>
          {cv.map((n, i) => (
            <div key={i} className="curve-col">
              <span className="curve-n">{n || ""}</span>
              <span className="curve-bar" style={{ height: `${(n / max) * 100}%` }} />
              <span className="curve-x">{i === 7 ? "7+" : i}</span>
            </div>
          ))}
        </div>
        {colors.length > 1 ? (
          <div className="pips-row">
            <span className="small-label">Colors in costs</span>
            <div className="pipbar">
              {colors.map((c) => (
                <span key={c} style={{ flexGrow: p[c], background: MANA_COLORS[c] }} title={`${c}: ${p[c]}`}>
                  {Math.round((p[c] / pipTotal) * 100)}%
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h3>Deck balance</h3>
        <p className="verdict">{balance}</p>
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
        <p className="fine">Shaded: the usual range for a Commander deck in brackets 2 and 3.</p>
      </section>
      {openers ? <OpenersView report={openers} /> : null}
      <section className="panel" data-testid="deck-cost">
        <h3>What it costs</h3>
        <p className="panel-big">€{cost.eur.toFixed(0)}</p>
        <p className="fine">
          Cardmarket trend prices from Scryfall, basics left out{cost.missing ? `, ${cost.missing} card${cost.missing === 1 ? "" : "s"} without a price` : ""}.
        </p>
        <DeckBoxesPanel deck={deck} />
      </section>
    </div>
  );
}

function sentence(words: string[], cap = true) {
  const w = [...words];
  if (cap) w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.length < 2 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
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

/** The numbers most people want, in one line under the description. */
function DeckStats({ deck, validation, openers: r }: { deck: Deck; validation: Validation; openers: OpenerReport | null }) {
  const cost = price(deck);
  const lands = deck.cards.filter(isLand).reduce((n, c) => n + c.qty, 0);
  const b = bracketInfo(deck.bracket ?? 3);
  const fits = bracketChecks(deck, validation).every(([ok]) => ok);
  const items: [string, string][] = [
    ["Price", `€${cost.eur.toFixed(0)}`],
    ["Lands", String(lands)],
    ["Average mana value", averageMv(deck).toFixed(2)],
    ...(r ? ([["Keeps its first 7", `${Math.round(r.keep7 * 100)}%`]] as [string, string][]) : []),
    ["Bracket", `${b.number}${fits ? " ✓" : " !"}`],
  ];
  return (
    <dl className="deck-stats" data-testid="deck-stats">
      {items.map(([k, v]) => (
        <div key={k} className="deck-stat">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function bracketChecks(deck: Deck, validation: Validation): [boolean, string][] {
  const BRACKET = bracketInfo(deck.bracket ?? 3);
  const gc = validation.gameChangers;
  const mldWarn = validation.warnings.find((w) => w.includes("mass land denial"));
  const turnWarn = validation.warnings.find((w) => w.includes("extra-turn"));
  return [
    [
      gc.length <= BRACKET.maxGameChangers,
      BRACKET.maxGameChangers >= 99 ? `${gc.length} Game Changers (no limit in Bracket 4)${gc.length ? `: ${gc.join(", ")}` : ""}` : BRACKET.maxGameChangers === 0 ? (gc.length ? `${gc.length} Game Changers: ${gc.join(", ")} (Bracket ${BRACKET.number} allows none)` : "No Game Changers") : `${gc.length} of ${BRACKET.maxGameChangers} Game Changers${gc.length ? `: ${gc.join(", ")}` : ""}`,
    ],
    [!mldWarn, mldWarn ? mldWarn : "No mass land denial"],
    [!turnWarn, turnWarn ? turnWarn : "No chained extra turns"],
    [validation.total === 100, `${validation.total} cards, singleton, all in color identity`],
  ];
}

/** One line ("Fits Bracket 3") that opens to the checks; open by itself when something is off. */
function BracketCard({ deck, validation }: { deck: Deck; validation: Validation }) {
  const BRACKET = bracketInfo(deck.bracket ?? 3);
  const items = bracketChecks(deck, validation);
  const off = items.filter(([ok]) => !ok).length;
  const known = new Set(items.map(([, t]) => t));
  const notes = validation.warnings.filter((w) => !known.has(w));
  return (
    <details className={`bracket ${off ? "is-off" : ""}`} open={off > 0 || undefined} data-testid="bracket-card">
      <summary>
        <span className="bracket-mark" aria-hidden>
          {off ? "!" : "✓"}
        </span>
        {off ? `Bracket ${BRACKET.number}: ${off} thing${off === 1 ? "" : "s"} to check` : `Fits Bracket ${BRACKET.number} (${BRACKET.name})`}
      </summary>
      <ul>
        {items.map(([ok, text]) => (
          <li key={text} className={ok ? "is-ok" : "is-warn"}>
            <span aria-hidden>{ok ? "✓" : "!"}</span> {text}
          </li>
        ))}
      </ul>
      {deck.bracketNotes ? <p className="bracket-note">{deck.bracketNotes}</p> : null}
      {notes.length ? (
        <>
          <p className="bracket-note">Notes from the deck check:</p>
          <ul className="bracket-notes">
            {notes.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
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
          {!isBasicLand(card.name) ? <CardOffers name={card.name} /> : null}
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

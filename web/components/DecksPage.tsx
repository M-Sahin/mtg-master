"use client";
// /decks: every deck you built. In your account when you're logged in (with an offer to move the
// ones in this browser there), otherwise the ones kept in this browser. Each deck can be opened,
// shared, improved by Claude, built again from the same seeds, renamed and deleted.
import { useEffect, useMemo, useState } from "react";
import { cardByName, handoff, myDecks, resolveDeck, saveAfterLogin, type SavedDeck } from "../lib/client/api";
import { cloudDecks, useAccount } from "../lib/client/account";
import type { Deck } from "../lib/shared/types";
import { modelInfo } from "../lib/shared/models";
import { deckSeeds } from "../lib/shared/deck-utils";
import { IdentityPips } from "./CardFace";
import { LoginDialog } from "./LoginDialog";
import { Menu } from "./Menu";
import { ShareSheet } from "./ShareSheet";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

// commander art for the cards: looked up once per name and kept for this tab
const art = new Map<string, Promise<string | null>>();
function commanderArt(name: string): Promise<string | null> {
  const key = `hundredfold:art:${name}`;
  if (!art.has(name)) {
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(key);
    } catch {}
    art.set(
      name,
      cached
        ? Promise.resolve(cached || null)
        : cardByName(name)
            .then((c) => {
              const url = c.artCrop ?? null;
              try {
                sessionStorage.setItem(key, url ?? "");
              } catch {}
              return url;
            })
            .catch(() => null),
    );
  }
  return art.get(name)!;
}

function made(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  const date = new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  if (days <= 0) return `Today, ${new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date;
}

type Sort = "new" | "name";

export default function DecksPage() {
  const acct = useAccount();
  const signedIn = !!acct.user;
  const [local, setLocal] = useState<SavedDeck[]>([]);
  const [cloud, setCloud] = useState<SavedDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [login, setLogin] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("new");

  useEffect(() => setLocal(myDecks.list()), []);

  const loadCloud = async () => {
    try {
      setCloud(await cloudDecks.list());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Move browser decks into the account; only the ones that made it leave the browser. */
  const move = async (decks: SavedDeck[]) => {
    if (!decks.length) return;
    setMoving(true);
    setError(null);
    try {
      const r = await cloudDecks.importMany(decks);
      if (!r.skipped) for (const d of decks) myDecks.remove(d.id);
      else setError(`${r.skipped} deck${r.skipped === 1 ? "" : "s"} couldn't be read and stay${r.skipped === 1 ? "s" : ""} in this browser.`);
      setLocal(myDecks.list());
      await loadCloud();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setMoving(false);
    }
  };

  useEffect(() => {
    if (!acct.loaded) return;
    if (!signedIn) {
      setCloud(null);
      return;
    }
    void (async () => {
      await loadCloud();
      // back from "Save to my account": move the deck(s) the visitor asked to save
      const want = saveAfterLogin.get();
      if (want?.length) {
        saveAfterLogin.set(null);
        const decks = myDecks.list().filter((d) => want.includes(d.id));
        if (decks.length && (await move(decks))) setNote(decks.length === 1 ? `“${decks[0].name}” is saved to your account.` : `${decks.length} decks are saved to your account.`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct.loaded, signedIn]);

  const list = useMemo(() => {
    const all = signedIn ? (cloud ?? []) : local;
    const q = query.trim().toLowerCase();
    const hit = q ? all.filter((d) => `${d.name} ${d.commander} ${d.partner ?? ""}`.toLowerCase().includes(q)) : all;
    return [...hit].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.at - a.at));
  }, [signedIn, cloud, local, query, sort]);
  const total = signedIn ? (cloud?.length ?? 0) : local.length;

  const update = (d: SavedDeck, patch: Partial<SavedDeck> | null) => {
    if (d.cloud) setCloud((l) => (l ? (patch ? l.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) : l.filter((x) => x.id !== d.id)) : l));
    else setLocal(myDecks.list());
  };

  return (
    <div className="app">
      <SiteHeader active="decks" />
      <main className="decks-page">
        <header className="decks-head">
          <div>
            <h1>My decks</h1>
            <p className="decks-sub">
              {!acct.loaded ? "Loading…" : signedIn ? (cloud === null && !error ? "Loading your decks…" : `${total} deck${total === 1 ? "" : "s"} in your account, on every device you log in on.`) : `${total} deck${total === 1 ? "" : "s"} in this browser.`}
            </p>
          </div>
          <a className="btn btn--brass" href="/">
            Build a new deck
          </a>
        </header>

        {acct.loaded && acct.enabled && !signedIn ? (
          <div className="decks-banner" data-testid="decks-login">
            <p>
              <strong>These decks only live in this browser.</strong> Clearing it, or another device, loses them. A free account keeps them everywhere: no password, just your email.
            </p>
            <button type="button" className="btn btn--brass" onClick={() => setLogin(true)}>
              Save them to an account
            </button>
          </div>
        ) : null}
        {signedIn && local.length ? (
          <div className="decks-banner">
            <p>
              {local.length} deck{local.length === 1 ? " is" : "s are"} only in this browser.
            </p>
            <button type="button" className="btn btn--brass" onClick={() => void move(local)} disabled={moving} data-testid="import-decks">
              {moving ? "Moving…" : "Move to my account"}
            </button>
          </div>
        ) : null}
        {note ? (
          <p className="decks-note" role="status">
            {note}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}

        {total > 6 ? (
          <div className="decks-tools">
            <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a deck or commander" aria-label="Find a deck" />
            <div className="viewswitch" role="group" aria-label="Sort">
              {(
                [
                  ["new", "Newest"],
                  ["name", "A–Z"],
                ] as [Sort, string][]
              ).map(([s, label]) => (
                <button key={s} type="button" className={`viewswitch-btn ${sort === s ? "is-on" : ""}`} aria-pressed={sort === s} onClick={() => setSort(s)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {acct.loaded && !(signedIn && cloud === null) && !total ? (
          <section className="decks-empty">
            <h2>No decks yet</h2>
            <p>Pick five cards you love and Claude builds the other 95. Every deck you build lands here.</p>
            <a className="btn btn--brass btn--big" href="/">
              Build your first deck
            </a>
          </section>
        ) : null}

        <ul className="decks-grid" data-testid="my-decks">
          {list.map((d) => (
            <DeckCardItem key={d.id} deck={d} onChange={(patch) => update(d, patch)} onError={setError} />
          ))}
        </ul>
        {query && !list.length && total ? <p className="decks-sub">No deck matches &ldquo;{query}&rdquo;.</p> : null}
      </main>
      <LoginDialog
        open={login}
        onClose={() => setLogin(false)}
        title="Keep your decks everywhere"
        lead="Log in, or make an account with just your email. Your decks from this browser move into it."
        next="/decks"
      />
      {login ? <SaveIntent ids={local.map((d) => d.id)} /> : null}
      <SiteFooter />
    </div>
  );
}

/** While the login dialog is open: remember which browser decks to move once logged in. */
function SaveIntent({ ids }: { ids: string[] }) {
  useEffect(() => {
    saveAfterLogin.set(ids);
  }, [ids]);
  return null;
}

function DeckCardItem({ deck: d, onChange, onError }: { deck: SavedDeck; onChange: (patch: Partial<SavedDeck> | null) => void; onError: (m: string | null) => void }) {
  const [bg, setBg] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState<{ deck: Deck; d: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<boolean | null>(null); // can it be built again from its seeds?

  useEffect(() => {
    let live = true;
    void commanderArt(d.commander).then((u) => live && setBg(u));
    return () => {
      live = false;
    };
  }, [d.commander]);

  const payload = async () => (d.cloud ? await cloudDecks.payload(d.id) : d.d);
  const go = async (kind: "open" | "rebuild" | "upgrade") => {
    setBusy(kind);
    onError(null);
    try {
      handoff.set({ kind, d: await payload(), usage: d.usage, model: d.model });
      window.location.href = "/";
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  };
  const share = async () => {
    setBusy("share");
    onError(null);
    try {
      const p = await payload();
      const r = await resolveDeck(p);
      setSharing({ deck: r.deck, d: p });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // "Build again" needs the five seeds: check once the menu could show it
  const checkSeeds = async () => {
    if (seeds !== null) return;
    try {
      const r = await resolveDeck(await payload());
      setSeeds(!!deckSeeds(r.deck));
    } catch {
      setSeeds(false);
    }
  };
  const rename = async () => {
    const name = (renaming ?? "").trim();
    setRenaming(null);
    if (!name || name === d.name) return;
    try {
      if (d.cloud) await cloudDecks.rename(d.id, name);
      else myDecks.rename(d.id, name);
      onChange({ name });
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const remove = async () => {
    try {
      if (d.cloud) await cloudDecks.remove(d.id);
      else myDecks.remove(d.id);
      onChange(null);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <li className="deckcard" data-testid="deck-card" onPointerEnter={() => void checkSeeds()} onFocus={() => void checkSeeds()}>
      <button type="button" className="deckcard-art" style={bg ? { backgroundImage: `url("${bg}")` } : undefined} onClick={() => void go("open")} aria-label={`Open ${d.name}`}>
        <span className="deckcard-pips">
          <IdentityPips colors={d.colors} size={14} />
        </span>
      </button>
      <div className="deckcard-body">
        {renaming !== null ? (
          <form
            className="deckcard-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <input className="field" value={renaming} maxLength={120} autoFocus onChange={(e) => setRenaming(e.target.value)} aria-label="Deck name" />
            <button type="submit" className="btn btn--small" disabled={!renaming.trim()}>
              Save
            </button>
          </form>
        ) : (
          <h2 className="deckcard-name">
            <button type="button" onClick={() => void go("open")}>
              {d.name}
            </button>
          </h2>
        )}
        <p className="deckcard-cmd">
          {d.commander}
          {d.partner ? ` + ${d.partner}` : ""}
        </p>
        <p className="deckcard-meta">
          {made(d.at)}
          {d.model ? ` · ${modelInfo(d.model)?.label.replace("Claude ", "") ?? d.model}` : ""}
        </p>
        {confirmDelete ? (
          <div className="deckcard-confirm" role="group" aria-label="Delete this deck?">
            <span>Delete this deck?</span>
            <button type="button" className="btn btn--small btn--danger" onClick={() => void remove()}>
              Delete
            </button>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <div className="deckcard-actions">
            <button type="button" className="btn btn--small" onClick={() => void go("open")} disabled={!!busy}>
              {busy === "open" ? "Opening…" : "Open"}
            </button>
            <button type="button" className="btn btn--small" onClick={() => void share()} disabled={!!busy}>
              {busy === "share" ? "One moment…" : "Share"}
            </button>
            <Menu
              label="More"
              className="btn btn--small btn--quiet"
              testId="deck-more"
              items={[
                { label: "Improve it with Claude (up to 10 swaps)", onClick: () => void go("upgrade"), testId: "deck-upgrade" },
                ...(seeds !== false ? [{ label: "Build again from the same seeds", onClick: () => void go("rebuild"), testId: "deck-rebuild" }] : []),
                { label: "Rename", onClick: () => setRenaming(d.name) },
                { label: "Delete", onClick: () => setConfirmDelete(true), testId: "deck-delete" },
              ]}
            />
          </div>
        )}
      </div>
      {sharing ? <ShareSheet deck={sharing.deck} shareD={sharing.d} onClose={() => setSharing(null)} /> : null}
    </li>
  );
}

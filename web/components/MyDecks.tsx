"use client";
// My decks: the decks in your account when you're logged in (with an offer to move the ones
// in this browser there), otherwise the decks kept in this browser. Entries are the compact share
// payload, rebuilt with fresh card data when opened.
import { useEffect, useState } from "react";
import { myDecks, type SavedDeck } from "../lib/client/api";
import { cloudDecks, useAccount } from "../lib/client/account";
import { costUsd, formatCost } from "../lib/shared/models";
import { IdentityPips } from "./CardFace";

export function MyDecks({ onOpen, version, showEmpty = false }: { onOpen: (d: SavedDeck) => void; version: number; showEmpty?: boolean }) {
  const acct = useAccount();
  const signedIn = !!acct.user;
  const [local, setLocal] = useState<SavedDeck[]>([]);
  const [cloud, setCloud] = useState<SavedDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => setLocal(myDecks.list()), [version]);
  useEffect(() => {
    if (!signedIn) {
      setCloud(null);
      return;
    }
    let live = true;
    cloudDecks
      .list()
      .then((l) => live && setCloud(l))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [signedIn, version]);

  const importLocal = async () => {
    setImporting(true);
    setError(null);
    try {
      const r = await cloudDecks.importMany(local);
      // only clear this browser when every deck made it into the account
      if (!r.skipped) {
        myDecks.clear();
        setLocal([]);
      } else setError(`${r.skipped} deck${r.skipped === 1 ? "" : "s"} couldn't be read and stay${r.skipped === 1 ? "s" : ""} in this browser.`);
      setCloud(await cloudDecks.list());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    try {
      await cloudDecks.rename(id, name);
      setCloud((l) => l?.map((d) => (d.id === id ? { ...d, name } : d)) ?? l);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (d: SavedDeck) => {
    if (d.cloud) {
      setCloud((l) => l?.filter((x) => x.id !== d.id) ?? l);
      try {
        await cloudDecks.remove(d.id);
      } catch (e) {
        setError((e as Error).message);
        setCloud(await cloudDecks.list().catch(() => cloud));
      }
    } else {
      myDecks.remove(d.id);
      setLocal(myDecks.list());
    }
  };

  const list = signedIn ? (cloud ?? []) : local;
  const where = signedIn ? "saved to your account" : acct.enabled ? "saved in this browser · log in to keep them everywhere" : "saved in this browser";
  if (!list.length && !(signedIn && local.length) && !(signedIn && cloud === null))
    return showEmpty ? (
      <section id="my-decks" className="panel mydecks" aria-label="My decks">
        <div className="panel-head">
          <h3>My decks</h3>
        </div>
        <p className="panel-sub">No saved decks yet. Every deck you build here is {signedIn ? "saved to your account" : "kept in this browser"}, so you can open it again later.</p>
      </section>
    ) : null;

  return (
    <section id="my-decks" className="panel mydecks" aria-label="My decks" data-testid="my-decks">
      <div className="panel-head">
        <h3>My decks</h3>
        <span className="pill pill--quiet">{where}</span>
      </div>
      {signedIn && local.length ? (
        <div className="mydecks-import">
          <span className="panel-sub">
            {local.length} deck{local.length === 1 ? " is" : "s are"} saved only in this browser.
          </span>
          <button type="button" className="btn btn--brass" onClick={() => void importLocal()} disabled={importing} data-testid="import-decks">
            {importing ? "Moving…" : "Move to my account"}
          </button>
        </div>
      ) : null}
      {signedIn && cloud === null && !error ? <p className="panel-sub">Loading your decks…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <ul className="mydecks-list">
        {list.map((d) => (
          <li key={d.id}>
            {renaming?.id === d.id ? (
              <form
                className="mydecks-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
              >
                <input className="field" value={renaming.name} maxLength={120} autoFocus onChange={(e) => setRenaming({ id: d.id, name: e.target.value })} aria-label="Deck name" />
                <button type="submit" className="btn" disabled={!renaming.name.trim()}>
                  Save
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="mydecks-open" onClick={() => onOpen(d)}>
                <IdentityPips colors={d.colors} size={14} />
                <span className="mydecks-name">{d.name}</span>
                <span className="mydecks-meta">
                  {d.commander}
                  {d.partner ? ` + ${d.partner}` : ""} · {new Date(d.at).toLocaleDateString()}
                  {d.usage && d.model ? ` · ${formatCost(costUsd(d.model, d.usage))}` : ""}
                </span>
              </button>
            )}
            <span className="mydecks-actions">
              {d.cloud && renaming?.id !== d.id ? (
                <button type="button" className="btn btn--quiet" onClick={() => setRenaming({ id: d.id, name: d.name })} aria-label={`Rename ${d.name}`}>
                  Rename
                </button>
              ) : null}
              <button type="button" className="btn btn--quiet mydecks-del" aria-label={`Delete ${d.name}`} onClick={() => void remove(d)}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

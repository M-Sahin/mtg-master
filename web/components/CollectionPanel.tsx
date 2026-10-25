"use client";
// "Build from my collection": paste a list or load a CSV export; prefer owned cards or use only them.
import { useEffect, useState } from "react";
import { storage } from "../lib/client/api";
import { parseCollection } from "../lib/shared/collection";
import { MAX_COLLECTION } from "../lib/shared/types";

export interface Collection {
  names: string[];
  mode: "prefer" | "only";
  source: string;
}

const saved = storage<Collection>("hundredfold:collection");

export function CollectionPanel({ value, onChange, inactive }: { value: Collection | null; onChange: (c: Collection | null) => void; inactive?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const c = saved.get();
    if (c?.names?.length) onChange(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (c: Collection | null) => {
    saved.set(c);
    onChange(c);
  };

  const load = (raw: string, source: string) => {
    const { names, tooMany } = parseCollection(raw);
    if (!names.length) {
      setNote("No card names found. Paste one card per line, or a CSV export with a Name column.");
      return;
    }
    setNote(tooMany ? `Only the first ${MAX_COLLECTION.toLocaleString()} different cards were kept.` : null);
    set({ names, mode: value?.mode ?? "prefer", source });
    setOpen(false);
    setText("");
  };

  const file = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setNote("That file is over 5 MB. Export only the card list.");
      return;
    }
    load(await f.text(), f.name);
  };

  return (
    <section className="panel" aria-label="Your collection">
      <div className="panel-head">
        <h3>Build from your collection</h3>
        {value ? <span className="pill">{value.names.length.toLocaleString()} cards</span> : <span className="pill pill--quiet">optional</span>}
      </div>
      {value ? (
        <>
          <p className="panel-sub">
            Loaded from {value.source}.{" "}
            <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
              Replace
            </button>{" "}
            ·{" "}
            <button type="button" className="link" onClick={() => set(null)}>
              Remove
            </button>
          </p>
          <div className="seg seg--two" role="radiogroup" aria-label="How to use your collection">
            {(
              [
                ["prefer", "Prefer my cards", "Owned cards first; buy a few where they're clearly better"],
                ["only", "Only my cards", "Nothing to buy (seeds and basic lands are always allowed)"],
              ] as const
            ).map(([mode, label, hint]) => (
              <label key={mode} className={`seg-item ${value.mode === mode ? "is-on" : ""}`}>
                <input type="radio" name="collection-mode" checked={value.mode === mode} onChange={() => set({ ...value, mode })} />
                <span className="seg-title">{label}</span>
                <span className="seg-hint">{hint}</span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <p className="panel-sub">
          Export your collection from Moxfield, Archidekt, ManaBox or Deckbox as CSV, or paste a list with one card per line. It stays in your browser and is sent with your build.{" "}
          <button type="button" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Cancel" : "Add my collection"}
          </button>
        </p>
      )}
      {open ? (
        <div className="collection-input">
          <label className="btn">
            Choose a CSV or text file
            <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => file(e.target.files?.[0])} />
          </label>
          <textarea className="field" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1 Sol Ring\n1 Arcane Signet\n1 Meren of Clan Nel Toth"} aria-label="Paste your collection" />
          <button type="button" className="btn btn--brass" disabled={!text.trim()} onClick={() => load(text, "a pasted list")}>
            Use this list
          </button>
        </div>
      ) : null}
      {note ? <p className="note">{note}</p> : null}
      {value && inactive ? <p className="note">{inactive}</p> : null}
    </section>
  );
}

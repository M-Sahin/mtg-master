"use client";
// Decks kept in this browser. Each entry is the compact share payload, rebuilt with fresh card data when opened.
import { useEffect, useState } from "react";
import { myDecks, type SavedDeck } from "../lib/client/api";
import { costUsd, formatCost } from "../lib/shared/models";
import { IdentityPips } from "./CardFace";

export function MyDecks({ onOpen, version }: { onOpen: (d: SavedDeck) => void; version: number }) {
  const [list, setList] = useState<SavedDeck[]>([]);
  useEffect(() => setList(myDecks.list()), [version]);
  if (!list.length) return null;
  return (
    <section className="panel mydecks" aria-label="My decks">
      <div className="panel-head">
        <h3>My decks</h3>
        <span className="pill pill--quiet">saved in this browser</span>
      </div>
      <ul className="mydecks-list">
        {list.map((d) => (
          <li key={d.id}>
            <button type="button" className="mydecks-open" onClick={() => onOpen(d)}>
              <IdentityPips colors={d.colors} size={14} />
              <span className="mydecks-name">{d.name}</span>
              <span className="mydecks-meta">
                {d.commander}
                {d.partner ? ` + ${d.partner}` : ""} · {new Date(d.at).toLocaleDateString()}
                {d.usage && d.model ? ` · ${formatCost(costUsd(d.model, d.usage))}` : ""}
              </span>
            </button>
            <button
              type="button"
              className="btn btn--quiet mydecks-del"
              aria-label={`Delete ${d.name}`}
              onClick={() => {
                myDecks.remove(d.id);
                setList(myDecks.list());
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

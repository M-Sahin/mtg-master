"use client";
import { useEffect, useId, useRef, useState } from "react";
import { autocomplete } from "../lib/client/api";

/** Card-name combobox backed by Scryfall autocomplete. */
export function CardSearch({ onPick, onClose, exclude }: { onPick: (name: string) => void; onClose: () => void; exclude: string[] }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const names = await autocomplete(q, ctl.signal);
        const ex = new Set(exclude.map((e) => e.toLowerCase()));
        setItems(names.filter((n) => !ex.has(n.toLowerCase())).slice(0, 8));
        setActive(0);
      } catch {
        /* aborted or offline */
      } finally {
        setBusy(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, exclude]);

  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [onClose]);

  return (
    <div className="search" ref={box}>
      <input
        ref={input}
        className="search-input"
        placeholder="Type a card name"
        value={q}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (items[active]) onPick(items[active]);
            else if (q.trim().length > 2) onPick(q.trim());
          } else if (e.key === "Escape") onClose();
        }}
      />
      <ul className="search-list" id={listId} role="listbox">
        {items.map((n, i) => (
          <li
            key={n}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? "is-active" : ""}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(n);
            }}
          >
            {n}
          </li>
        ))}
        {!items.length && q.trim().length >= 2 && !busy ? <li className="search-empty">No card by that name. Check the spelling.</li> : null}
      </ul>
    </div>
  );
}

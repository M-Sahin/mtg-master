"use client";
// A small dropdown menu: a button that opens a list of actions. Closes on a choice, Escape or a
// click elsewhere.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  testId?: string;
}

export function Menu({ label, items, className = "btn", testId }: { label: ReactNode; items: MenuItem[]; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("left");
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // keep the list on screen: open toward the side with room (a phone's right edge is close)
  useLayoutEffect(() => {
    if (!open) return setAlign("left");
    const btn = ref.current?.getBoundingClientRect();
    const list = listRef.current?.getBoundingClientRect();
    if (btn && list && btn.left + list.width > window.innerWidth - 12) setAlign("right");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    // move focus into the menu, so the keyboard can pick an item
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!items.length) return null;
  const move = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };
  return (
    <div className="menu" ref={ref}>
      <button type="button" className={`${className} menu-btn`} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div className={`menu-list ${align === "right" ? "menu-list--right" : ""}`} role="menu" id={id} onKeyDown={move} ref={listRef}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid={it.testId}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

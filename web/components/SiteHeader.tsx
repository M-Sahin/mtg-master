"use client";
// The site's navbar: the tools on the left, GitHub and Support on the right, and a menu
// button on phones. Every page uses it.
import { useEffect, useState, type ReactNode } from "react";
import { loadConfig } from "../lib/client/site-config";
import { AccountButton } from "./AccountButton";

export type NavKey = "build" | "bracket" | "ev" | "decks" | null;

const REPO = "https://github.com/M-Sahin/mtg-master";

const LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: "build", href: "/", label: "Build a deck" },
  { key: "bracket", href: "/bracket", label: "Bracket checker" },
  { key: "ev", href: "/ev", label: "Box EV" },
  { key: "decks", href: "/#my-decks", label: "My decks" },
];

export function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect x="5" y="4" width="16" height="22" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" transform="rotate(-10 13 15)" />
      <rect x="11" y="6" width="16" height="22" rx="2.5" fill="currentColor" opacity=".9" transform="rotate(8 19 17)" />
    </svg>
  );
}

/**
 * `donationUrl`: pass it when the page already has the config; otherwise the header asks
 * /api/config once. `extra` goes on the right (badges like the skill version).
 */
export function SiteHeader({ active, donationUrl, extra }: { active: NavKey; donationUrl?: string | null; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [donation, setDonation] = useState<string | null>(donationUrl ?? null);

  useEffect(() => {
    if (donationUrl !== undefined) {
      setDonation(donationUrl);
      return;
    }
    let live = true;
    void loadConfig().then((c) => live && setDonation(c?.donationUrl ?? null));
    return () => {
      live = false;
    };
  }, [donationUrl]);

  // close the phone menu on Escape and after following a link
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const outside = (
    <>
      <a className="nav-link nav-link--quiet" href={REPO} target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      {donation ? (
        <a className="nav-link nav-support" href={donation} target="_blank" rel="noopener noreferrer">
          Support
        </a>
      ) : null}
    </>
  );

  return (
    <header className={`top site-nav ${open ? "is-open" : ""}`}>
      <a className="wordmark" href="/" aria-label="Hundredfoldz home">
        <Mark /> Hundredfoldz
      </a>
      <nav className="nav-main" aria-label="Main">
        {LINKS.map((l) => (
          <a key={l.href} className={`nav-link ${active === l.key ? "is-active" : ""}`} href={l.href} aria-current={active === l.key ? "page" : undefined} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
      </nav>
      <span className="nav-side">
        {extra}
        {outside}
        <AccountButton />
      </span>
      <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="nav-menu" onClick={() => setOpen((o) => !o)} data-testid="nav-toggle">
        <span className="visually-hidden">{open ? "Close menu" : "Menu"}</span>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          {open ? <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
      </button>
      {open ? (
        <nav id="nav-menu" className="nav-menu" aria-label="Menu">
          {LINKS.map((l) => (
            <a key={l.href} className={`nav-link ${active === l.key ? "is-active" : ""}`} href={l.href} aria-current={active === l.key ? "page" : undefined} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <span className="nav-menu-side">
            {outside}
            <AccountButton onNavigate={() => setOpen(false)} />
          </span>
        </nav>
      ) : null}
    </header>
  );
}

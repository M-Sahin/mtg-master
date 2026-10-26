"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { exportText } from "../lib/shared/deck-utils";
import { encodeDeck, shareTitle } from "../lib/shared/share";
import { IMPORT_SITES, redditPost, shareTargets } from "../lib/shared/share-targets";
import type { Deck } from "../lib/shared/types";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "Share deck" button plus the sheet it opens. The whole deck travels inside the link. */
export function ShareButton({ deck, shareD }: { deck: Deck; shareD?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--brass" onClick={() => setOpen(true)}>
        <ShareIcon /> Share deck
      </button>
      {open ? <ShareSheet deck={deck} shareD={shareD} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ShareSheet({ deck, shareD, onClose }: { deck: Deck; shareD?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal?.();
    let live = true;
    (async () => {
      let d: string;
      try {
        d = shareD ?? (await encodeDeck(deck));
      } catch {
        if (live) setError("Couldn't create a link in this browser. Copy the list instead.");
        return;
      }
      // the server returns a short link when a store is set up, and always uses the public domain
      let link = `${window.location.origin}/deck?d=${d}`;
      try {
        const r = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ d }) });
        const j = await r.json();
        if (r.ok && typeof j.url === "string") link = j.url;
      } catch {
        /* keep the long link */
      }
      if (live) setUrl(link);
    })();
    return () => {
      live = false;
    };
  }, [deck, shareD]);

  const title = shareTitle({ n: deck.name, c: deck.commander.name, p: deck.partner?.name, br: deck.bracket });
  const targets = useMemo(() => (url ? shareTargets({ url, title }) : []), [url, title]);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2200);
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label="Share this deck">
      <div className="sheet-inner">
        <div className="sheet-head">
          <h3>Share this deck</h3>
          <button type="button" className="btn btn--quiet" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <p className="sheet-sub">Anyone with the link can see this deck.</p>

        {error ? <p className="error">{error}</p> : null}

        <div className="sheet-link">
          <input className="field" readOnly value={url || "Creating link…"} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} data-testid="share-url" />
          <button type="button" className="btn btn--brass" disabled={!url} onClick={async () => flash((await copyText(url)) ? "Link copied" : "Select the link and copy it yourself")}>
            Copy link
          </button>
        </div>

        {canNative && url ? (
          <button
            type="button"
            className="btn sheet-native"
            onClick={() => navigator.share({ title, text: `${title}. Built with Hundredfoldz.`, url }).catch(() => {})}
          >
            <ShareIcon /> Share with an app on this device
          </button>
        ) : null}

        <div className="sheet-group">
          <h4>Send it</h4>
          <div className="sheet-grid">
            {targets.map((t) => (
              <a key={t.id} className={`sheet-target sheet-target--${t.id}`} href={t.href} target="_blank" rel="noopener noreferrer">
                <span className="sheet-dot" aria-hidden />
                {t.label}
              </a>
            ))}
            <button
              type="button"
              className="sheet-target sheet-target--redditpost"
              disabled={!url}
              onClick={async () => flash((await copyText(redditPost(deck, url))) ? "Reddit post copied: paste it in a text post" : "Your browser blocked the clipboard")}
            >
              <span className="sheet-dot" aria-hidden />
              Copy as Reddit post
            </button>
          </div>
        </div>

        <div className="sheet-group">
          <h4>Open in a deckbuilding site</h4>
          <div className="sheet-grid">
            {IMPORT_SITES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sheet-target sheet-target--${s.id}`}
                onClick={async () => {
                  const ok = await copyText(exportText(deck));
                  window.open(s.href, "_blank", "noopener,noreferrer");
                  flash(ok ? `List copied. In ${s.label}: ${s.hint}.` : "Your browser blocked the clipboard. Use Copy list on the deck page.");
                }}
              >
                <span className="sheet-dot" aria-hidden />
                {s.label}
              </button>
            ))}
          </div>
          <p className="sheet-hint">These sites can't receive a deck through a link, so we copy the list for you to paste in their importer.</p>
        </div>

        <p className="sheet-note" role="status" aria-live="polite">
          {note ?? ""}
        </p>
      </div>
    </dialog>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

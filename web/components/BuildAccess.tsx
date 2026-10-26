"use client";
// How the next build runs, in one line under the Build button (a free build, your key, or the
// demo), and the key sheet: the key setup only appears when a build needs it or you ask for it.
import { useEffect, useRef, type ReactNode } from "react";
import type { FreeBuilds, PublicConfig } from "../lib/client/api";
import { modelInfo } from "../lib/shared/models";
import { KeyPanel, type KeyState } from "./KeyPanel";

export type Access = "own" | "free" | "server" | "demo" | "none";

export function BuildStatus({ config, access, keyState, free, onSheet, deckMode = false }: { config: PublicConfig | null; access: Access; keyState: KeyState; free: FreeBuilds | null; onSheet: (lead?: string) => void; deckMode?: boolean }) {
  if (!config) return null;
  const strong = "Sonnet or Opus";
  const freeModel = config.freeBuilds?.modelLabel ?? "Claude Haiku";
  const addKey = (label: string, lead?: string) => (
    <button type="button" className="link" onClick={() => onSheet(lead)} data-testid="add-key">
      {label}
    </button>
  );
  let line: ReactNode = null;
  if (access === "own")
    line = (
      <>
        Building with your key (…{keyState.saved?.last4 ?? keyState.key.slice(-4)}{keyState.saved ? ", saved to your account" : ""}) on {modelInfo(keyState.model)?.label ?? keyState.model}. {addKey("Change")}
      </>
    );
  else if (access === "free")
    line = (
      <>
        {free ? `Free build: ${free.remaining} of ${free.limit} left, on ${freeModel}.` : `Free builds on ${freeModel}.`} {config.ownKeys ? <>For {strong}, {addKey("use your own key", `Free builds use ${freeModel}. With your own key you can pick Claude Sonnet 5.5 or Opus 5.5, and you pay Anthropic directly: about 25 cents a deck on Sonnet.`)}.</> : null}
      </>
    );
  else if (access === "none" && config.freeBuilds)
    line = (
      <>
        {free?.blocked ? "Today's free builds are used up." : `You've used your ${config.freeBuilds.limit} free builds.`} {config.ownKeys ? <>{addKey("Add your Claude API key")} to keep building, on any model.</> : null}
      </>
    );
  else if (config.mode === "demo" && !keyState.key && !keyState.saved && deckMode)
    line = config.ownKeys ? (
      <>
        Completing or upgrading a deck needs a Claude API key. {addKey("Add yours", "Completing or upgrading a deck needs a Claude API key. You pay Anthropic directly: about 25 cents a deck on Sonnet.")}.
      </>
    ) : (
      "Completing or upgrading a deck needs a Claude API key on this site."
    );
  else if (config.mode === "demo" && !keyState.key && !keyState.saved)
    line = config.ownKeys ? (
      <>
        Without an API key this builds the demo deck. {addKey("Add your Claude API key", "Building your own seeds needs a Claude API key. You pay Anthropic directly: about 25 cents a deck on Sonnet.")} to build your own.
      </>
    ) : (
      "Demo mode: load the demo seeds to watch a scripted build."
    );
  return line ? (
    <p className="build-status" data-testid="build-status">
      {line}
    </p>
  ) : null;
}

/** The key sheet: a dialog with the key panel. `lead` says why it opened. */
export function KeySheet({ open, lead, value, onChange, onClose, onDone, canSave = false }: { open: boolean; lead?: string; value: KeyState; onChange: (v: KeyState) => void; onClose: () => void; onDone: () => void; canSave?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  // the panel stays mounted while the sheet is closed: it loads a remembered key on startup
  return (
    <dialog ref={ref} className="modal keysheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label="Your Claude API key" data-testid="key-sheet">
      <div className="keysheet-inner">
        <KeyPanel value={value} onChange={onChange} lead={lead} onDone={onDone} canSave={canSave} />
        <div className="keysheet-actions">
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            {value.key || value.saved ? "Done" : "Not now"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

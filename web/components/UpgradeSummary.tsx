"use client";
// Upgrade mode: the swaps Claude suggests for the user's deck, above the upgraded deck.
import { useState } from "react";
import type { Swap } from "../lib/shared/types";

export function UpgradeSummary({ swaps }: { swaps: Swap[] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = swaps.map((s) => `- ${s.out} → + ${s.in}${s.why ? ` (${s.why})` : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the list is on screen */
    }
  };
  return (
    <section className="panel upgrade" aria-label="Suggested upgrades" data-testid="upgrade-summary">
      <div className="panel-head">
        <h3>{swaps.length ? `${swaps.length} suggested swap${swaps.length === 1 ? "" : "s"}` : "No swaps suggested"}</h3>
        {swaps.length ? (
          <button type="button" className="btn btn--quiet" onClick={copy}>
            {copied ? "Copied" : "Copy the swaps"}
          </button>
        ) : null}
      </div>
      {swaps.length ? (
        <>
          <p className="panel-sub">Every other card is yours, unchanged. The deck below has the swaps in it; new cards are marked &ldquo;New&rdquo;.</p>
          <ol className="swaps">
            {swaps.map((s) => (
              <li key={`${s.out}>${s.in}`} className="swap">
                <span className="swap-out">{s.out}</span>
                <span className="swap-arrow" aria-label="replaced by">
                  →
                </span>
                <span className="swap-in">{s.in}</span>
                {s.why ? <span className="swap-why">{s.why}</span> : null}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="panel-sub">Claude didn&apos;t find a change worth making for this bracket and budget. Your deck is shown below as it is.</p>
      )}
    </section>
  );
}

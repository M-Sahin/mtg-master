"use client";
// "Deck shape (optional)": min and max counts for creatures, lands, ramp, draw, removal and
// wipes, and a cap on the average mana value. Empty fields mean "no limit".
import { useState } from "react";
import { SHAPE_KEYS, SHAPE_LABELS, SHAPE_TYPICAL, cleanShape, type DeckShape, type ShapeKey } from "../lib/shared/shape";

export type ShapeDraft = Record<ShapeKey, { min: string; max: string }> & { maxAvgMv: string };

export const emptyShape = (): ShapeDraft => ({ ...(Object.fromEntries(SHAPE_KEYS.map((k) => [k, { min: "", max: "" }])) as Record<ShapeKey, { min: string; max: string }>), maxAvgMv: "" });

/** The draft as a request shape (undefined = no limits), or the problem with it. */
export function draftToShape(d: ShapeDraft): DeckShape | undefined | string {
  return cleanShape({ ...Object.fromEntries(SHAPE_KEYS.map((k) => [k, { min: d[k].min, max: d[k].max }])), maxAvgMv: d.maxAvgMv });
}

export function DeckShapeFields({ value, onChange }: { value: ShapeDraft; onChange: (v: ShapeDraft) => void }) {
  const parsed = draftToShape(value);
  const active = typeof parsed === "object" && parsed ? Object.keys(parsed).length : 0;
  // open while editing, also while a limit is invalid (the error must stay visible)
  const [open, setOpen] = useState(active > 0);
  const set = (k: ShapeKey, side: "min" | "max", v: string) => onChange({ ...value, [k]: { ...value[k], [side]: v.replace(/[^\d]/g, "").slice(0, 2) } });
  return (
    <details className="opt shape" open={open || typeof parsed === "string"} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="deck-shape">
      <summary className="opt-label">
        Deck shape {active ? <span className="pill">{`${active} limit${active === 1 ? "" : "s"}`}</span> : <span className="opt-summary-hint">min and max creatures, lands, ramp…</span>}
      </summary>
      <p className="opt-hint">Empty means no limit. Counted from the card text; a deck that misses one goes back to Claude.</p>
      <div className="shape-grid">
        <span className="shape-head" />
        <span className="shape-head">Min</span>
        <span className="shape-head">Max</span>
        <span className="shape-head">Typical</span>
        {SHAPE_KEYS.map((k) => (
          <div key={k} className="shape-row" role="group" aria-label={SHAPE_LABELS[k]}>
            <span className="shape-label">{SHAPE_LABELS[k]}</span>
            <input className="field" inputMode="numeric" value={value[k].min} onChange={(e) => set(k, "min", e.target.value)} aria-label={`${SHAPE_LABELS[k]} minimum`} data-testid={`shape-${k}-min`} />
            <input className="field" inputMode="numeric" value={value[k].max} onChange={(e) => set(k, "max", e.target.value)} aria-label={`${SHAPE_LABELS[k]} maximum`} data-testid={`shape-${k}-max`} />
            <span className="shape-typical">{SHAPE_TYPICAL[k]}</span>
          </div>
        ))}
        <div className="shape-row" role="group" aria-label="Average mana value">
          <span className="shape-label">Average mana value</span>
          <span className="shape-dash">—</span>
          <input className="field" inputMode="decimal" value={value.maxAvgMv} onChange={(e) => onChange({ ...value, maxAvgMv: e.target.value.replace(/[^\d.]/g, "").slice(0, 4) })} aria-label="Average mana value maximum" placeholder="3.2" />
          <span className="shape-typical">2.8–3.4</span>
        </div>
      </div>
      {typeof parsed === "string" ? <p className="error">{parsed}</p> : null}
      {active ? (
        <button type="button" className="link" onClick={() => onChange(emptyShape())}>
          Clear the limits
        </button>
      ) : null}
    </details>
  );
}

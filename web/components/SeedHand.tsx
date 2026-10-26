"use client";
import { useState } from "react";
import type { CardInfo } from "../lib/shared/types";
import { CardFace } from "./CardFace";
import { CardSearch } from "./CardSearch";

export interface Seed {
  name: string;
  info?: CardInfo;
  loading?: boolean;
  error?: string;
}

export function seedProblem(s: Seed): string | null {
  if (s.error) return s.error;
  if (!s.info) return null;
  if (s.info.legalCommander === "banned") return "Banned in Commander";
  if (s.info.legalCommander === "not_legal") return "Not legal in Commander";
  return null;
}

export function SeedHand({
  seeds,
  commander,
  onPick,
  onRemove,
  onCommander,
  disabled,
}: {
  seeds: (Seed | null)[];
  commander: string | null;
  onPick: (slot: number, name: string) => void;
  onRemove: (slot: number) => void;
  onCommander: (name: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const names = seeds.filter(Boolean).map((s) => s!.name);
  return (
    <div className="hand" role="list" aria-label="Your five seed cards">
      {seeds.map((s, i) => {
        const problem = s ? seedProblem(s) : null;
        const isCmd = !!s && commander?.toLowerCase() === s.name.toLowerCase();
        return (
          <div key={i} role="listitem" className={`hand-slot ${s ? "is-filled" : ""} ${isCmd ? "is-commander" : ""} ${open === i ? "is-open" : ""}`} style={{ ["--i" as string]: i - 2 }}>
            {s ? (
              <>
                <div className={`flip ${s.loading ? "" : "is-flipped"}`}>
                  <div className="flip-back sleeve" aria-hidden />
                  <div className="flip-front">{s.info || s.error ? <CardFace card={s.info} name={s.name} tilt loading="eager" /> : null}</div>
                </div>
                <div className="slot-tools">
                  {s.info?.canBeCommander ? (
                    <button
                      type="button"
                      className={`chip chip--crown ${isCmd ? "is-on" : ""}`}
                      aria-pressed={isCmd}
                      disabled={disabled}
                      onClick={() => onCommander(isCmd ? null : s.name)}
                      title={isCmd ? "This is your commander. Click to let Claude choose instead." : "Make this the commander"}
                    >
                      <Crown /> {isCmd ? "Commander" : "Make commander"}
                    </button>
                  ) : null}
                </div>
                <button type="button" className="slot-x" disabled={disabled} onClick={() => onRemove(i)} aria-label={`Remove ${s.name}`} title="Remove">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                    <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
                {problem ? <p className="slot-problem">{problem}</p> : null}
              </>
            ) : open === i ? (
              <div className="slot-empty is-searching">
                <CardSearch
                  exclude={names}
                  onClose={() => setOpen(null)}
                  onPick={(n) => {
                    setOpen(null);
                    onPick(i, n);
                  }}
                />
              </div>
            ) : (
              <button type="button" className="slot-empty sleeve" disabled={disabled} onClick={() => setOpen(i)}>
                <span className="slot-plus" aria-hidden>
                  +
                </span>
                <span>Add card {i + 1}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Crown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z" />
    </svg>
  );
}

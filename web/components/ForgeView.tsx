"use client";
import { useEffect, useRef, useState } from "react";
import { describeQuery } from "../lib/shared/query-text";
import { ROLE_COLORS } from "../lib/shared/deck-utils";
import type { Role, Validation } from "../lib/shared/types";
import { ROLE_LABELS } from "../lib/shared/types";

export type LogItem =
  | { kind: "text"; text: string }
  | { kind: "status"; text: string }
  | { kind: "tool"; id: string; name: string; label: string; summary?: string; ok?: boolean }
  | { kind: "validation"; attempt: number; validation: Validation };

export interface DraftCell {
  name: string;
  role: Role;
}

const TOOL_VERB: Record<string, string> = { search_cards: "Looked for", get_cards: "Read", submit_deck: "Checked deck", revise_deck: "Reviewed deck" };

export function ForgeView({
  log,
  draft,
  commander,
  filled,
  elapsed,
  onCancel,
  spend,
}: {
  log: LogItem[];
  draft: DraftCell[];
  commander?: string;
  filled: number;
  elapsed: number;
  onCancel: () => void;
  spend?: string; // tokens and estimated cost so far, on the visitor's key
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const [raw, setRaw] = useState(false); // show the Scryfall queries as Claude wrote them
  const touched = useRef(0); // when the visitor last scrolled by hand
  useEffect(() => {
    const mark = () => (touched.current = Date.now());
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
    };
  }, []);
  // while the list is being written, the grid is where things happen; otherwise the newest log line
  const last = log[log.length - 1];
  const writing = draft.length > 0 && filled < 100 && last?.kind === "status" && /^Writing the/.test(last.text);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // on a phone (and narrow windows) the log isn't a scroll box of its own: the page follows the
    // build, unless the visitor scrolled in the last few seconds to look at something
    if (getComputedStyle(el).maxHeight !== "none" || Date.now() - touched.current < 6000) return;
    const target = writing ? gridRef.current : caretRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: writing ? "start" : "end" });
  }, [log, writing, draft.length]);

  const cells = Array.from({ length: 100 }, (_, i) => (i === 0 ? (commander ? { name: commander, role: "wincon" as Role, cmd: true } : null) : draft[i - 1] ? { ...draft[i - 1], cmd: false } : i < filled ? { name: "Basic land", role: "land" as Role, cmd: false } : null));
  const count = cells.filter(Boolean).length;
  const legend = [...new Set(draft.map((d) => d.role))];

  return (
    <section className="forge" aria-live="polite">
      <div className="forge-notes">
        <div className="forge-head">
          <h2>Building your deck</h2>
          <span className="forge-time">{formatTime(elapsed)}</span>
        </div>
        {spend ? <p className="forge-spend">So far: {spend}</p> : null}
        <div className="forge-log" ref={logRef}>
          {log.map((item, i) => {
            if (item.kind === "text") return <p key={i} className="log-text">{item.text}</p>;
            if (item.kind === "status") return <p key={i} className="log-status">{item.text}</p>;
            if (item.kind === "tool") {
              const plain = item.name === "search_cards" && !raw ? describeQuery(item.label) : null;
              return (
                <div key={i} className={`log-tool ${item.summary ? (item.ok ? "is-ok" : "is-warn") : "is-busy"}`} title={item.name === "search_cards" ? `Scryfall: ${item.label}` : undefined}>
                  <span className="log-tool-verb">{TOOL_VERB[item.name] ?? item.name}</span>
                  {plain ? <span className="log-tool-plain">{plain}</span> : <code className="log-tool-q">{item.label}</code>}
                  <span className="log-tool-res">{item.summary ? item.summary.replace(/ matches$/, " found") : "…"}</span>
                </div>
              );
            }
            const v = item.validation;
            return (
              <div key={i} className={`log-check ${v.ok ? "is-ok" : "is-warn"}`}>
                <strong>{v.ok ? `Deck check passed: ${v.total} cards, ${v.gameChangers.length} of 3 Game Changers` : `Deck check found ${v.errors.length} problem${v.errors.length === 1 ? "" : "s"}. Claude is fixing ${v.errors.length === 1 ? "it" : "them"}.`}</strong>
                {!v.ok ? (
                  <ul>
                    {v.errors.slice(0, 5).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          <span className="log-caret" aria-hidden ref={caretRef} />
        </div>
        <div className="forge-foot">
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            Stop building
          </button>
          {log.some((x) => x.kind === "tool" && x.name === "search_cards") ? (
            <button type="button" className="link link--quiet" onClick={() => setRaw((r) => !r)} aria-pressed={raw}>
              {raw ? "Plain words" : "Show the Scryfall queries"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="forge-hundred" ref={gridRef}>
        <div className="hundred-count" aria-label={`${count} of 100 cards`}>
          <span className="hundred-num">{count}</span>
          <span className="hundred-of">of 100</span>
        </div>
        <div className="hundred" role="img" aria-label={`Deck grid, ${count} of 100 slots filled`}>
          {cells.map((c, i) => (
            <span
              key={i}
              className={`cell ${c ? "is-in" : ""} ${c?.cmd ? "is-cmd" : ""}`}
              style={c ? { ["--c" as string]: ROLE_COLORS[c.role], ["--d" as string]: `${(i % 10) * 12}ms` } : undefined}
              title={c ? `${c.name} (${ROLE_LABELS[c.role]})` : undefined}
            />
          ))}
        </div>
        <div className="hundred-latest">{draft.length ? <>Latest: <strong>{draft[draft.length - 1].name}</strong></> : commander ? <>Commander: <strong>{commander}</strong></> : "Waiting for the list"}</div>
        {legend.length ? (
          <ul className="legend">
            {legend.map((r) => (
              <li key={r}>
                <span className="legend-dot" style={{ background: ROLE_COLORS[r] }} />
                {ROLE_LABELS[r]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

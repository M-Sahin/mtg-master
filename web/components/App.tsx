"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRACKET } from "../lib/shared/bracket";
import { MANA_COLORS } from "../lib/shared/deck-utils";
import type { Budget, Color, Deck, StreamEvent, Validation } from "../lib/shared/types";
import { cardByName, generate, getConfig, randomCard, storage, type PublicConfig } from "../lib/client/api";
import { IdentityPips } from "./CardFace";
import { DeckView } from "./DeckView";
import { ForgeView, type DraftCell, type LogItem } from "./ForgeView";
import { SeedHand, seedProblem, type Seed } from "./SeedHand";

type Phase = "setup" | "forging" | "result";
interface Result {
  deck: Deck;
  validation: Validation;
}

const lastDeck = storage<Result>("hundredfold:last-deck");
const savedCode = storage<string>("hundredfold:access-code");

const BUDGETS: [Budget, string, string][] = [
  ["any", "No limit", "Best cards, whatever they cost"],
  ["mid", "Mid", "Roughly €150–250"],
  ["budget", "Budget", "Under about €75"],
];

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [seeds, setSeeds] = useState<(Seed | null)[]>([null, null, null, null, null]);
  const [commander, setCommander] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget>("any");
  const [theme, setTheme] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [log, setLog] = useState<LogItem[]>([]);
  const [draft, setDraft] = useState<DraftCell[]>([]);
  const [draftCmd, setDraftCmd] = useState<string | undefined>();
  const [filled, setFilled] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState<Result | null>(null);
  const [surprising, setSurprising] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig(null));
    setSaved(lastDeck.get());
    setAccessCode(savedCode.get() ?? "");
  }, []);

  const filledSeeds = seeds.filter(Boolean) as Seed[];
  const identity = useMemo(() => {
    const set = new Set<Color>();
    for (const s of filledSeeds) for (const c of s.info?.colorIdentity ?? []) set.add(c);
    return (["W", "U", "B", "R", "G"] as Color[]).filter((c) => set.has(c));
  }, [filledSeeds]);
  const tintSource = phase === "result" && result ? result.deck.colorIdentity : identity;

  const problems = filledSeeds.map(seedProblem).filter(Boolean) as string[];
  const ready = filledSeeds.length === 5 && filledSeeds.every((s) => s.info && !s.loading) && problems.length === 0;
  const needCode = config?.accessCodeRequired && !accessCode.trim();

  const pick = useCallback(async (slot: number, name: string) => {
    setError(null);
    setSeeds((cur) => cur.map((s, i) => (i === slot ? { name, loading: true } : s)));
    try {
      const info = await cardByName(name);
      setSeeds((cur) => {
        if (cur.some((s, i) => i !== slot && s?.info?.name === info.name)) {
          setError(`${info.name} is already one of your seeds.`);
          return cur.map((s, i) => (i === slot ? null : s));
        }
        return cur.map((s, i) => (i === slot ? { name: info.name, info } : s));
      });
    } catch (e) {
      setSeeds((cur) => cur.map((s, i) => (i === slot ? { name, error: (e as Error).message } : s)));
    }
  }, []);

  const remove = (slot: number) => {
    const s = seeds[slot];
    if (s && commander === s.name) setCommander(null);
    setSeeds((cur) => cur.map((x, i) => (i === slot ? null : x)));
  };

  const loadSeeds = async (names: string[], cmd: string | null = null) => {
    setSeeds([null, null, null, null, null]);
    setCommander(null);
    await Promise.all(names.slice(0, 5).map((n, i) => pick(i, n)));
    setCommander(cmd);
  };

  const surprise = async () => {
    setSurprising(true);
    setError(null);
    try {
      const empty = seeds.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      if (!empty.length) return;
      let id = identity.map((c) => c.toLowerCase()).join("");
      let picks: string[] = [];
      if (!filledSeeds.some((s) => s.info?.canBeCommander)) {
        const c = await randomCard("commander", "");
        picks.push(c.name);
        id = c.colorIdentity.map((x) => x.toLowerCase()).join("") || "c";
      }
      for (let tries = 0; picks.length < empty.length && tries < 20; tries++) {
        const c = await randomCard("card", id);
        if (!picks.includes(c.name) && !filledSeeds.some((s) => s.name === c.name)) picks.push(c.name);
      }
      picks = picks.slice(0, empty.length);
      await Promise.all(empty.map((slot, k) => pick(slot, picks[k])));
    } catch (e) {
      setError(`Couldn't get random cards: ${(e as Error).message}`);
    } finally {
      setSurprising(false);
    }
  };

  const build = async () => {
    if (!ready) return;
    savedCode.set(accessCode.trim() || null);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase("forging");
    setLog([]);
    setDraft([]);
    setDraftCmd(commander ?? undefined);
    setFilled(0);
    setError(null);
    setResult(null);
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - start), 250);
    let got: Result | null = null;
    try {
      for await (const ev of generate({ seeds: filledSeeds.map((s) => s.info!.name), commander, budget, theme }, accessCode.trim(), ctl.signal)) {
        handle(ev);
        if (ev.type === "deck") got = { deck: ev.deck, validation: ev.validation };
        if (ev.type === "error") setError(ev.message);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(`The connection dropped: ${(e as Error).message}. Try again.`);
    } finally {
      clearInterval(timer);
    }
    if (ctl.signal.aborted) return;
    if (got) {
      setFilled(100);
      setResult(got);
      lastDeck.set(got);
      setSaved(got);
      // let the grid finish its last fill before revealing the deck
      setTimeout(() => {
        setPhase("result");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 900);
    } else {
      setPhase("setup");
    }
  };

  const handle = (ev: StreamEvent) => {
    switch (ev.type) {
      case "status":
        if (ev.text) setLog((l) => [...l, { kind: "status", text: ev.text }]);
        break;
      case "text":
        setLog((l) => {
          const last = l[l.length - 1];
          if (last?.kind === "text") return [...l.slice(0, -1), { kind: "text", text: last.text + ev.delta }];
          return [...l, { kind: "text", text: ev.delta }];
        });
        break;
      case "tool":
        setLog((l) => [...l, { kind: "tool", id: ev.id, name: ev.name, label: ev.label }]);
        break;
      case "tool_result":
        setLog((l) => l.map((x) => (x.kind === "tool" && x.id === ev.id ? { ...x, summary: ev.summary, ok: ev.ok } : x)));
        break;
      case "draft_start":
        setDraft([]);
        setFilled(0);
        setLog((l) => [...l, { kind: "status", text: ev.attempt > 1 ? "Writing the corrected list" : "Writing the full list" }]);
        break;
      case "draft_meta":
        if (ev.commander) setDraftCmd(ev.commander);
        break;
      case "draft_card":
        setDraft((d) => [...d, { name: ev.name, role: ev.role }]);
        break;
      case "validation":
        setLog((l) => [...l, { kind: "validation", attempt: ev.attempt, validation: ev.validation }]);
        if (ev.validation.ok) setFilled(ev.validation.total);
        break;
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setPhase("setup");
  };

  const restart = () => {
    setPhase("setup");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tint = tintSource.length ? tintSource : null;
  return (
    <div className="app" style={tint ? tintStyle(tint) : undefined}>
      <header className="top">
        <a className="wordmark" href="/" aria-label="Hundredfold home">
          <Mark /> Hundredfold
        </a>
        <span className="top-meta">
          {config ? (
            config.mode === "demo" ? (
              <span className="pill pill--demo" title="No ANTHROPIC_API_KEY set: the app replays a scripted build of one sample deck.">
                Demo mode
              </span>
            ) : (
              <span className="pill" title={`Claude model: ${config.model}`}>
                mtg-master skill {config.skillVersion}
              </span>
            )
          ) : null}
        </span>
      </header>

      {phase === "setup" ? (
        <main className="setup">
          <section className="hero">
            <h1>
              Five cards in.
              <br />A hundred out.
            </h1>
            <p className="hero-sub">Pick five cards you love. Claude builds a full Bracket {BRACKET.number} Commander deck around them, checks every card on Scryfall, and shows its work while it builds.</p>
          </section>

          <section className="mat" aria-label="Seed cards">
            <SeedHand seeds={seeds} commander={commander} onPick={pick} onRemove={remove} onCommander={setCommander} />
            <div className="mat-bar">
              <span className="mat-identity">
                {filledSeeds.length ? (
                  <>
                    <IdentityPips colors={identity} size={16} /> {identity.length ? `${identity.length}-color` : "Colorless"} so far, {filledSeeds.length} of 5 cards
                  </>
                ) : (
                  "Your seeds can be any five Commander-legal cards, including a commander."
                )}
              </span>
              <span className="mat-actions">
                {config?.mode === "demo" ? (
                  <button type="button" className="btn" onClick={() => loadSeeds(config.demoSeeds, config.demoSeeds[0])}>
                    Load the demo seeds
                  </button>
                ) : null}
                {filledSeeds.length < 5 ? (
                  <button type="button" className="btn" onClick={surprise} disabled={surprising}>
                    {surprising ? "Shuffling…" : filledSeeds.length ? "Fill the rest randomly" : "Surprise me"}
                  </button>
                ) : null}
              </span>
            </div>
          </section>

          <section className="options" aria-label="Build options">
            <div className="opt">
              <span className="opt-label" id="cmd-label">
                Commander
              </span>
              <p className="opt-value" aria-labelledby="cmd-label">
                {commander ? (
                  <>
                    <strong>{commander}</strong>{" "}
                    <button type="button" className="link" onClick={() => setCommander(null)}>
                      Let Claude choose instead
                    </button>
                  </>
                ) : (
                  <>Claude picks the best commander for your seeds. To choose one yourself, use the crown on a legendary creature.</>
                )}
              </p>
            </div>
            <fieldset className="opt">
              <legend className="opt-label">Budget</legend>
              <div className="seg">
                {BUDGETS.map(([v, label, hint]) => (
                  <label key={v} className={`seg-item ${budget === v ? "is-on" : ""}`}>
                    <input type="radio" name="budget" value={v} checked={budget === v} onChange={() => setBudget(v)} />
                    <span className="seg-title">{label}</span>
                    <span className="seg-hint">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="opt">
              <span className="opt-label">Anything else?</span>
              <input className="field" value={theme} maxLength={300} onChange={(e) => setTheme(e.target.value)} placeholder="For example: lots of tokens, no infinite combos, flavor over power" />
            </label>
            {config?.accessCodeRequired ? (
              <label className="opt">
                <span className="opt-label">Access code</span>
                <input className="field" type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Ask the person who runs this app" autoComplete="off" />
              </label>
            ) : null}
          </section>

          <div className="go">
            <button type="button" className="btn btn--big btn--brass" onClick={build} disabled={!ready || !!needCode}>
              Build my deck
            </button>
            <p className="go-hint">
              {!ready
                ? problems.length
                  ? problems[0]
                  : `Add ${5 - filledSeeds.length} more card${5 - filledSeeds.length === 1 ? "" : "s"} to start.`
                : needCode
                  ? "Enter the access code to start."
                  : "Takes one to three minutes. You can watch every step."}
            </p>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            {saved ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setResult(saved);
                  setPhase("result");
                }}
              >
                Open your last deck: {saved.deck.name}
              </button>
            ) : null}
          </div>
        </main>
      ) : null}

      {phase === "forging" ? (
        <main>
          <ForgeView log={log} draft={draft} commander={draftCmd} filled={filled} elapsed={elapsed} onCancel={cancel} />
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </main>
      ) : null}

      {phase === "result" && result ? (
        <main>
          <DeckView deck={result.deck} validation={result.validation} onRestart={restart} onRebuild={ready ? build : undefined} />
        </main>
      ) : null}

      <footer className="foot">
        <p>
          Built on the <a href="https://github.com/M-Sahin/mtg-master">mtg-master Claude skill</a>. Card data and images from <a href="https://scryfall.com">Scryfall</a>. Unofficial fan content, not affiliated with Wizards of the Coast. Magic: The Gathering is a trademark of Wizards of the Coast LLC.
        </p>
      </footer>
    </div>
  );
}

function tintStyle(colors: Color[]) {
  const c = colors.map((x) => MANA_COLORS[x]);
  const a = c[0];
  const b = c[1] ?? c[0];
  const d = c[2] ?? b;
  return { ["--tint-a" as string]: a, ["--tint-b" as string]: b, ["--tint-c" as string]: d };
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect x="5" y="4" width="16" height="22" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" transform="rotate(-10 13 15)" />
      <rect x="11" y="6" width="16" height="22" rx="2.5" fill="currentColor" opacity=".9" transform="rotate(8 19 17)" />
    </svg>
  );
}

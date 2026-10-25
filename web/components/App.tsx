"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRACKETS, type BracketNumber } from "../lib/shared/bracket";
import { DeckStartPanel, splitBasics, type StartDeck } from "./DeckStartPanel";
import { MANA_COLORS } from "../lib/shared/deck-utils";
import type { Budget, Color, Deck, GenerateRequest, StreamEvent, Swap, Usage, Validation } from "../lib/shared/types";
import { cardByName, generate, getConfig, myDecks, randomCard, resolveDeck, runningBuild, stopBuild, storage, type PublicConfig, type SavedDeck } from "../lib/client/api";
import { costUsd, formatCost, formatTokens, modelInfo } from "../lib/shared/models";
import { encodeDeck } from "../lib/shared/share";
import { CollectionPanel, type Collection } from "./CollectionPanel";
import { KeyPanel, type KeyState } from "./KeyPanel";
import { MyDecks } from "./MyDecks";
import { SiteHeader } from "./SiteHeader";
import { IdentityPips } from "./CardFace";
import { DeckView } from "./DeckView";
import { UpgradeSummary } from "./UpgradeSummary";
import { ForgeView, type DraftCell, type LogItem } from "./ForgeView";
import { SeedHand, seedProblem, type Seed } from "./SeedHand";

type Phase = "setup" | "forging" | "result";
interface Result {
  deck: Deck;
  validation: Validation;
  usage?: Usage;
  model?: string;
  /** Upgrade mode: the swaps Claude made to the user's deck. */
  swaps?: Swap[];
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
  const [bracket, setBracket] = useState<BracketNumber>(3);
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
  const jobId = useRef<string | undefined>(undefined);
  const [key, setKey] = useState<KeyState>({ key: "", model: "" });
  const [collection, setCollection] = useState<Collection | null>(null);
  const [usage, setUsage] = useState<{ usage: Usage; model?: string } | null>(null);
  const [decksVersion, setDecksVersion] = useState(0);
  const [decksHash, setDecksHash] = useState(false);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig(null));
    setSaved(lastDeck.get());
    setAccessCode(savedCode.get() ?? "");
    // the phone reloaded the tab mid-build: show the seeds again and pick the build back up
    const running = runningBuild.get();
    if (running) {
      void loadSeeds(running.req.seeds, running.req.commander);
      setBudget(running.req.budget);
      setTheme(running.req.theme ?? "");
      void run(running.req, running.job);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const needCode = config?.accessCodeRequired && !accessCode.trim() && !key.key;
  // without a key (yours or the server's) only the scripted demo deck can be built
  const demoOnly = config?.mode === "demo" && !key.key;
  const blocked = config?.setupProblem ?? null;

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
    await run({
      seeds: filledSeeds.map((s) => s.info!.name),
      commander,
      budget,
      theme,
      bracket,
      ...(collection && !demoOnly ? { collection: { names: collection.names, mode: collection.mode } } : {}),
    });
  };

  /** "Yes, complete my deck": every card the user has stays; Claude fills the deck to 100. */
  const complete = async (d: StartDeck) => {
    savedCode.set(accessCode.trim() || null);
    const { names, basics } = splitBasics(d.cards);
    await run({
      mode: "complete",
      seeds: names,
      basics,
      commander: d.commander,
      partner: d.partner ?? null,
      budget,
      theme,
      bracket,
      ...(collection ? { collection: { names: collection.names, mode: collection.mode } } : {}),
    });
  };

  /** "Suggest upgrades": Claude proposes up to 10 swaps for a finished deck. */
  const upgrade = async (d: StartDeck) => {
    savedCode.set(accessCode.trim() || null);
    const { names, basics } = splitBasics(d.cards);
    await run({
      mode: "upgrade",
      seeds: names,
      basics,
      commander: d.commander,
      partner: d.partner ?? null,
      budget,
      theme,
      bracket,
      ...(collection ? { collection: { names: collection.names, mode: collection.mode } } : {}),
    });
  };

  /** Start a build, or (with `resume`) reattach to one that was running before a reload. */
  const run = async (req: GenerateRequest, resume?: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    jobId.current = resume;
    setPhase("forging");
    setLog([]);
    setDraft([]);
    setDraftCmd(req.commander ?? undefined);
    setFilled(0);
    setError(null);
    setResult(null);
    setUsage(null);
    if (req.mode === "upgrade") {
      // the deck is already whole: show it in the grid while Claude looks for swaps
      setDraft([...req.seeds.map((name) => ({ name, role: "synergy" as const }))]);
      setFilled(100);
    }
    const start = resume ? (runningBuild.get()?.at ?? Date.now()) : Date.now();
    setElapsed(Date.now() - start);
    const timer = setInterval(() => setElapsed(Date.now() - start), 250);
    let got: Result | null = null;
    let spent: { usage: Usage; model?: string } | null = null;
    const own = key.key; // the key this tab shows (another tab may have saved a different one)
    try {
      for await (const ev of generate(req, { accessCode, apiKey: own || undefined, model: key.model || undefined }, ctl.signal, resume)) {
        if (!jobId.current) jobId.current = runningBuild.get()?.job;
        handle(ev);
        if (ev.type === "usage") {
          spent = { usage: ev.usage, model: ev.model };
          setUsage(spent);
        }
        if (ev.type === "deck") got = { deck: ev.deck, validation: ev.validation, ...(ev.swaps ? { swaps: ev.swaps } : {}) };
        if (ev.type === "error") setError(ev.message);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(`The connection dropped: ${(e as Error).message}. Try again.`);
    } finally {
      clearInterval(timer);
    }
    if (ctl.signal.aborted) return;
    if (got) {
      if (spent && spent.model !== "demo") Object.assign(got, spent);
      setFilled(100);
      setResult(got);
      lastDeck.set(got);
      setSaved(got);
      void saveToMyDecks(got);
      // let the grid finish its last fill before revealing the deck
      setTimeout(() => {
        setPhase("result");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 900);
    } else {
      setPhase("setup");
    }
  };

  const saveToMyDecks = async (r: Result) => {
    try {
      const d = await encodeDeck(r.deck);
      myDecks.add({
        id: d.slice(-12) + Date.now().toString(36),
        at: Date.now(),
        name: r.deck.name,
        commander: r.deck.commander.name,
        partner: r.deck.partner?.name,
        colors: r.deck.colorIdentity,
        d,
        ...(r.usage && r.model ? { usage: r.usage, model: r.model } : {}),
      });
      setDecksVersion((v) => v + 1);
    } catch {
      /* the deck is still shown; it just isn't added to My decks */
    }
  };

  const openSaved = async (s: SavedDeck) => {
    setError(null);
    try {
      const r = await resolveDeck(s.d);
      setResult({ ...r, usage: s.usage, model: s.model });
      setPhase("result");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
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
    void stopBuild(jobId.current ?? runningBuild.get()?.job);
    setPhase("setup");
  };

  // "My decks" in the navbar: /#my-decks opens the setup screen at the saved decks
  useEffect(() => {
    const onHash = () => {
      const on = window.location.hash === "#my-decks";
      setDecksHash(on);
      if (!on) return;
      setPhase((p) => (p === "forging" ? p : "setup"));
      setTimeout(() => document.getElementById("my-decks")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const restart = () => {
    setPhase("setup");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tint = tintSource.length ? tintSource : null;
  return (
    <div className="app" style={tint ? tintStyle(tint) : undefined}>
      <SiteHeader
        active={phase === "setup" && decksHash ? "decks" : "build"}
        donationUrl={config ? (config.donationUrl ?? null) : undefined}
        extra={
          config ? (
            config.mode === "demo" && !config.ownKeys ? (
              <span className="pill pill--demo" title="No ANTHROPIC_API_KEY set: the app replays a scripted build of one sample deck.">
                Demo mode
              </span>
            ) : (
              <span className="pill nav-pill" title={`Claude model: ${config.model}`}>
                skill {config.skillVersion}
              </span>
            )
          ) : null
        }
      />

      {phase === "setup" ? (
        <main className="setup">
          <section className="hero">
            <h1>
              Five cards in.
              <br />A hundred out.
            </h1>
            <p className="hero-sub">Pick five cards you love. Claude builds a full Commander deck around them in the bracket you choose, checks every card on Scryfall, and shows its work while it builds. Or let it complete a deck you started.</p>
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
            <fieldset className="opt">
              <legend className="opt-label">Bracket</legend>
              <div className="seg seg--four">
                {([1, 2, 3, 4] as BracketNumber[]).map((b) => (
                  <label key={b} className={`seg-item ${bracket === b ? "is-on" : ""}`} title={BRACKETS[b].rules.join(" ")}>
                    <input type="radio" name="bracket" value={b} checked={bracket === b} onChange={() => setBracket(b)} />
                    <span className="seg-title">
                      {b} · {BRACKETS[b].name}
                    </span>
                    <span className="seg-hint">{BRACKETS[b].hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="opt">
              <span className="opt-label">Anything else?</span>
              <input className="field" value={theme} maxLength={300} onChange={(e) => setTheme(e.target.value)} placeholder="For example: lots of tokens, no infinite combos, flavor over power" />
            </label>
            {config?.accessCodeRequired && !key.key ? (
              <label className="opt">
                <span className="opt-label">Access code</span>
                <input className="field" type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Ask the person who runs this app" autoComplete="off" />
              </label>
            ) : null}
          </section>

          <div className="panels">
            {config?.ownKeys ? <KeyPanel value={key} onChange={setKey} serverKey={config.mode === "live"} /> : null}
            <DeckStartPanel
              onComplete={complete}
              onUpgrade={upgrade}
              onRead={(r) => {
                if (r.bracket >= 1 && r.bracket <= 4) setBracket(r.bracket as BracketNumber);
              }}
              blocked={
                demoOnly
                  ? config?.ownKeys
                    ? "Completing or upgrading a deck needs a Claude API key: add yours in the key panel."
                    : "Completing or upgrading a deck needs a Claude API key on this site."
                  : needCode
                    ? "Enter the access code first."
                    : undefined
              }
            />
            <CollectionPanel value={collection} onChange={setCollection} inactive={demoOnly ? "Your collection is used once you add an API key; the demo deck ignores it." : undefined} />
          </div>

          <div className="go">
            <button type="button" className="btn btn--big btn--brass" onClick={build} disabled={!ready || !!needCode || (!!blocked && !key.key)}>
              Build my deck
            </button>
            <p className="go-hint">
              {blocked && !key.key
                ? blocked
                : !ready
                ? problems.length
                  ? problems[0]
                  : `Add ${5 - filledSeeds.length} more card${5 - filledSeeds.length === 1 ? "" : "s"} to start.`
                : needCode
                  ? config?.ownKeys
                    ? "Enter the access code, or use your own Claude API key, to start."
                    : "Enter the access code to start."
                  : demoOnly
                    ? config?.ownKeys
                      ? "Without an API key this builds the demo deck only: load the demo seeds, or add your Claude API key above."
                      : "Demo mode: load the demo seeds to watch a scripted build."
                    : "Takes one to three minutes. You can watch every step, and leave the page while it builds."}
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
          <MyDecks onOpen={openSaved} version={decksVersion} showEmpty={decksHash} />
        </main>
      ) : null}

      {phase === "forging" ? (
        <main>
          <ForgeView log={log} draft={draft} commander={draftCmd} filled={filled} elapsed={elapsed} onCancel={cancel} spend={usage && usage.model !== "demo" ? spendText(usage.usage, usage.model) : undefined} />
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </main>
      ) : null}

      {phase === "result" && result ? (
        <main>
          {result.swaps ? <UpgradeSummary swaps={result.swaps} /> : null}
          <DeckView
            deck={result.deck}
            validation={result.validation}
            added={result.swaps?.map((s) => s.in)}
            onRestart={restart}
            onRebuild={ready ? build : undefined}
            spend={result.usage && result.model ? `Built with ${modelInfo(result.model)?.label ?? result.model}: ${spendText(result.usage, result.model)}` : undefined}
            donationUrl={config?.donationUrl ?? undefined}
          />
        </main>
      ) : null}

      <footer className="foot">
        <p>
          Hundredfoldz is unofficial Fan Content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images via <a href="https://scryfall.com">Scryfall</a>. Free and open source: <a href="https://github.com/M-Sahin/mtg-master">built on the mtg-master Claude skill</a>.
          {config?.donationUrl ? (
            <>
              {" "}
              <a href={config.donationUrl} target="_blank" rel="noopener noreferrer">
                Support Hundredfoldz
              </a>
              .
            </>
          ) : null}
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


function spendText(u: Usage, model?: string) {
  return `${formatTokens(u)}, ${formatCost(model ? costUsd(model, u) : null)}`;
}

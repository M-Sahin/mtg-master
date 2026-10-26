"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRACKETS, type BracketNumber } from "../lib/shared/bracket";
import { DeckStartPanel, splitBasics, type StartDeck } from "./DeckStartPanel";
import { MANA_COLORS, deckSeeds } from "../lib/shared/deck-utils";
import type { Budget, Color, Deck, GenerateRequest, StreamEvent, Swap, Usage, Validation } from "../lib/shared/types";
import { cardByName, freeBuilds, generate, getConfig, handoff, myDecks, randomCard, resolveDeck, runningBuild, saveAfterLogin, stopBuild, storage, type FreeBuilds, type PublicConfig, type SavedDeck } from "../lib/client/api";
import { costUsd, formatCost, formatTokens, modelInfo } from "../lib/shared/models";
import { EXAMPLES, sameSeeds } from "../lib/shared/examples";
import { encodeDeck } from "../lib/shared/share";
import { CollectionPanel, type Collection } from "./CollectionPanel";
import type { KeyState } from "./KeyPanel";
import { BuildStatus, KeySheet, type Access } from "./BuildAccess";
import { LoginDialog } from "./LoginDialog";
import { SiteHeader } from "./SiteHeader";
import { cloudDecks, loadAccount, useAccount } from "../lib/client/account";
import { DeckShapeFields, draftToShape, emptyShape, type ShapeDraft } from "./DeckShapeFields";
import { IdentityPips } from "./CardFace";
import { DeckView } from "./DeckView";
import { UpgradeSummary } from "./UpgradeSummary";
import { ForgeView, type DraftCell, type LogItem } from "./ForgeView";
import { SeedHand, seedProblem, type Seed } from "./SeedHand";
import { useHumanCheck } from "./useHumanCheck";

type Phase = "setup" | "forging" | "result";
type Mode = "seeds" | "deck";
interface Result {
  deck: Deck;
  validation: Validation;
  usage?: Usage;
  model?: string;
  /** Built on one of the site's free builds (not the visitor's key). */
  free?: boolean;
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
  const [mode, setMode] = useState<Mode>("seeds");
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
  const keyRef = useRef(key);
  keyRef.current = key;
  const hasOwn = !!(key.key || key.saved); // a key in this browser, or one saved to the account
  const [free, setFree] = useState<FreeBuilds | null>(null);
  const [sheet, setSheet] = useState<{ lead?: string } | null>(null);
  const pending = useRef<GenerateRequest | null>(null);
  const human = useHumanCheck("build");
  const [collection, setCollection] = useState<Collection | null>(null);
  const [usage, setUsage] = useState<{ usage: Usage; model?: string } | null>(null);
  const acct = useAccount();
  // the deck just built, when it went into this browser only (logged out): offer to save it to an account
  const [localSave, setLocalSave] = useState<SavedDeck | null>(null);
  const [saveAsk, setSaveAsk] = useState<"ask" | "login" | "dismissed">("ask");
  const [hasDecks, setHasDecks] = useState(false);
  const [shape, setShape] = useState<ShapeDraft>(emptyShape);
  const shapeParsed = draftToShape(shape);
  const shapeReq = typeof shapeParsed === "object" ? shapeParsed : undefined;
  const shapeError = typeof shapeParsed === "string" ? shapeParsed : null;

  const refreshFree = useCallback(() => {
    void freeBuilds().then(setFree);
  }, []);

  useEffect(() => {
    getConfig()
      .then((c) => {
        setConfig(c);
        if (c.freeBuilds) refreshFree();
      })
      .catch(() => setConfig(null));
    setSaved(lastDeck.get());
    setHasDecks(myDecks.list().length > 0);
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
  const ready = filledSeeds.length === 5 && filledSeeds.every((s) => s.info && !s.loading) && problems.length === 0 && !shapeError;
  const needCode = config?.accessCodeRequired && !accessCode.trim() && !hasOwn;
  const blocked = config?.setupProblem ?? null;

  /** How a build of `req` would run right now. */
  const accessFor = (req: Pick<GenerateRequest, "seeds" | "mode"> | null): Access => {
    if (keyRef.current.key || keyRef.current.saved) return "own";
    if (!config) return "none";
    if (config.mode === "live") {
      if (config.freeBuilds) return !free || free.remaining > 0 ? "free" : "none";
      return "server";
    }
    // a site without a Claude key: only the scripted demo deck
    return req && !req.mode && sameSeeds(req.seeds, config.demoSeeds) ? "demo" : "none";
  };
  const access = accessFor(mode === "seeds" ? { seeds: filledSeeds.map((s) => s.info?.name ?? s.name) } : { seeds: [], mode: "complete" });

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

  /** Every build starts here: it runs now if it can, otherwise the key sheet opens first. */
  const start = (req: GenerateRequest) => {
    savedCode.set(accessCode.trim() || null);
    const a = accessFor(req);
    if (a === "none") {
      if (!config?.ownKeys) {
        setError(config?.freeBuilds ? "The free builds are used up." : "This site can only build the demo deck.");
        return;
      }
      pending.current = req;
      setSheet({
        lead: config.freeBuilds
          ? `You've used your ${config.freeBuilds.limit} free builds. Add your own Claude API key to keep building, on any model. You pay Anthropic directly: about 25 cents a deck on Sonnet.`
          : req.mode
            ? `${req.mode === "upgrade" ? "Upgrading" : "Completing"} a deck needs a Claude API key. You pay Anthropic directly: about 25 cents a deck on Sonnet.`
            : "Building your own seeds needs a Claude API key. You pay Anthropic directly: about 25 cents a deck on Sonnet.",
      });
      return;
    }
    void run(req, undefined, a);
  };

  const build = () => {
    if (!ready) return;
    start({
      seeds: filledSeeds.map((s) => s.info!.name),
      commander,
      budget,
      theme,
      bracket,
      ...(shapeReq ? { shape: shapeReq } : {}),
      ...(collection && accessFor(null) !== "none" ? { collection: { names: collection.names, mode: collection.mode } } : {}),
    });
  };

  /** "Complete my deck" (under 100 cards) or "Suggest upgrades" (a full deck). */
  const fromDeck = (kind: "complete" | "upgrade") => (d: StartDeck) => {
    const { names, basics } = splitBasics(d.cards);
    start({
      mode: kind,
      seeds: names,
      basics,
      commander: d.commander,
      partner: d.partner ?? null,
      budget,
      theme,
      bracket,
      ...(shapeReq ? { shape: shapeReq } : {}),
      ...(collection ? { collection: { names: collection.names, mode: collection.mode } } : {}),
    });
  };

  /** Start a build, or (with `resume`) reattach to one that was running before a reload. */
  const run = async (req: GenerateRequest, resume?: string, how: Access = "own") => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    jobId.current = resume;
    const own = keyRef.current; // the key this tab shows (another tab may have saved a different one)
    const isFree = !own.key && !own.saved && how === "free";
    // a free build carries a fresh bot-check token (before the screen changes, while the widget is on the page)
    const turnstile = isFree && !resume ? await human.take() : undefined;
    setPhase("forging");
    setLog([]);
    setDraft([]);
    setDraftCmd(req.commander ?? undefined);
    setFilled(0);
    setError(null);
    setResult(null);
    setUsage(null);
    window.scrollTo({ top: 0 });
    if (req.mode === "upgrade") {
      // the deck is already whole: show it in the grid while Claude looks for swaps
      setDraft([...req.seeds.map((name) => ({ name, role: "synergy" as const }))]);
      setFilled(100);
    }
    const startedAt = resume ? (runningBuild.get()?.at ?? Date.now()) : Date.now();
    setElapsed(Date.now() - startedAt);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    let got: Result | null = null;
    let spent: { usage: Usage; model?: string } | null = null;
    let freeUsed = false;
    try {
      for await (const ev of generate(req, { accessCode, apiKey: own.key || undefined, savedKey: !own.key && !!own.saved, model: own.model || undefined, turnstile }, ctl.signal, resume)) {
        if (!jobId.current) jobId.current = runningBuild.get()?.job;
        handle(ev);
        if (ev.type === "usage") {
          spent = { usage: ev.usage, model: ev.model };
          setUsage(spent);
        }
        if (ev.type === "deck") got = { deck: ev.deck, validation: ev.validation, ...(ev.swaps ? { swaps: ev.swaps } : {}) };
        if (ev.type === "error") {
          if (ev.code === "free_used") freeUsed = true;
          else if (ev.code === "saved_key") {
            setKey((k) => ({ key: k.key, model: k.model }));
            setError(ev.message);
          }
          else setError(ev.message);
        }
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(`The connection dropped: ${(e as Error).message}. Try again.`);
    } finally {
      clearInterval(timer);
    }
    if (config?.freeBuilds) refreshFree();
    if (ctl.signal.aborted) return;
    if (got) {
      if (spent && spent.model !== "demo") Object.assign(got, spent, isFree ? { free: true } : {});
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
      if (freeUsed) {
        // the server says there are none left (another tab, or the daily cap): ask for a key
        setFree((f) => (f ? { ...f, remaining: 0 } : { limit: config?.freeBuilds?.limit ?? 0, used: config?.freeBuilds?.limit ?? 0, remaining: 0, model: config?.freeBuilds?.model ?? "" }));
        pending.current = req;
        setSheet({ lead: "Your free builds are used up. Add your own Claude API key to keep building, on any model. You pay Anthropic directly: about 25 cents a deck on Sonnet." });
      }
    }
  };

  const saveToMyDecks = async (r: Result) => {
    try {
      const d = await encodeDeck(r.deck);
      const entry: SavedDeck = {
        id: d.slice(-12) + Date.now().toString(36),
        at: Date.now(),
        name: r.deck.name,
        commander: r.deck.commander.name,
        partner: r.deck.partner?.name,
        colors: r.deck.colorIdentity,
        d,
        // the cost only means something when it was the visitor's own key
        ...(r.usage && r.model && !r.free ? { usage: r.usage, model: r.model } : {}),
      };
      // logged in: into the account; otherwise (or if that fails) into this browser
      let ok = false;
      const a = await loadAccount();
      if (a.user) ok = await cloudDecks.save(entry).then(() => true, () => false);
      if (!ok) {
        myDecks.add(entry);
        if (a.enabled && !a.user) {
          setLocalSave(entry);
          setSaveAsk("ask");
        }
      } else setLocalSave(null);
      setHasDecks(true);
    } catch {
      /* the deck is still shown; it just isn't added to My decks */
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

  // old links to /#my-decks: the decks have their own page now
  useEffect(() => {
    if (window.location.hash === "#my-decks") window.location.replace("/decks");
  }, []);

  // from the My decks page: open a deck, or build from it (once the site's config is known)
  const handed = useRef(false);
  useEffect(() => {
    if (!config || handed.current) return;
    handed.current = true;
    const h = handoff.take();
    if (!h) return;
    void (async () => {
      try {
        const r = await resolveDeck(h.d);
        if (h.kind === "open") {
          setResult({ ...r, usage: h.usage, model: h.model });
          setPhase("result");
          return;
        }
        if (h.kind === "rebuild") {
          const s = deckSeeds(r.deck);
          if (!s) {
            setError("This deck wasn't built from five seeds, so it can't be built again. Try “Improve it with Claude” instead.");
            return;
          }
          const cmd = r.deck.commander.seed ? r.deck.commander.name : null;
          void loadSeeds(s, cmd);
          const b = ([1, 2, 3, 4] as const).find((x) => x === r.deck.bracket) ?? 3;
          setBracket(b);
          start({ seeds: s, commander: cmd, budget, theme, bracket: b });
          return;
        }
        // upgrade: every card stays a candidate, the commander and the plan stay
        const cards = r.deck.cards.map((c) => ({ name: c.name, qty: c.qty }));
        const { names, basics } = splitBasics(cards);
        const b = ([1, 2, 3, 4] as const).find((x) => x === r.deck.bracket) ?? 3;
        setBracket(b);
        start({ mode: "upgrade", seeds: names, basics, commander: r.deck.commander.name, partner: r.deck.partner?.name ?? null, budget, theme, bracket: b });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const restart = () => {
    setPhase("setup");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openSheet = (lead?: string) => {
    pending.current = null;
    setSheet({ lead });
  };
  const keyDone = () => {
    setSheet(null);
    // the sheet opened because a build needed a key: start that build now
    const req = pending.current;
    pending.current = null;
    if (req) setTimeout(() => void run(req, undefined, "own"), 50);
  };

  const moreSet = [theme.trim() ? 1 : 0, shapeReq ? 1 : 0, collection ? 1 : 0].reduce((a, b) => a + b, 0);
  const examples = config?.mode === "demo" && !hasOwn ? EXAMPLES.filter((e) => sameSeeds(e.seeds, config.demoSeeds)) : EXAMPLES;
  const tint = tintSource.length ? tintSource : null;
  const goHint = blocked && !hasOwn ? blocked : mode === "deck" ? null : !ready ? (problems.length ? problems[0] : `Add ${5 - filledSeeds.length} more card${5 - filledSeeds.length === 1 ? "" : "s"} to start.`) : needCode ? "Enter the access code to start." : "One to three minutes. You can leave the page while it builds.";

  return (
    <div className="app" style={tint ? tintStyle(tint) : undefined}>
      <SiteHeader
        active="build"
        donationUrl={config ? (config.donationUrl ?? null) : undefined}
        extra={
          config?.mode === "demo" && !config.ownKeys ? (
            <span className="pill pill--demo" title="No ANTHROPIC_API_KEY set: the app replays a scripted build of one sample deck.">
              Demo mode
            </span>
          ) : null
        }
      />

      {phase === "setup" ? (
        <main className="setup">
          {saved ? (
            <p className="welcome" data-testid="last-deck">
              <span>Your last deck</span>
              <button
                type="button"
                className="welcome-deck"
                onClick={() => {
                  setResult(saved);
                  setPhase("result");
                }}
              >
                <IdentityPips colors={saved.deck.colorIdentity} size={13} /> {saved.deck.name}
              </button>
            </p>
          ) : null}
          <section className="hero">
            <h1>
              Five cards in.
              <br />A hundred out.
            </h1>
            <p className="hero-sub">Pick five cards you love. Claude builds a 100-card Commander deck around them and checks every card on Scryfall.</p>
          </section>

          <div className="modes" role="tablist" aria-label="How to start">
            {(
              [
                ["seeds", "From five cards"],
                ["deck", "From my decklist"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`mode ${mode === m ? "is-on" : ""}`} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
                {label}
              </button>
            ))}
          </div>

          {mode === "seeds" ? (
            <section className="mat" aria-label="Seed cards">
              <SeedHand seeds={seeds} commander={commander} onPick={pick} onRemove={remove} onCommander={setCommander} />
              <div className="mat-bar">
                <span className="mat-identity">
                  {filledSeeds.length ? (
                    <>
                      <IdentityPips colors={identity} size={16} /> {identity.length ? `${identity.length}-color` : "Colorless"} so far, {filledSeeds.length} of 5 cards
                    </>
                  ) : (
                    "Any five Commander-legal cards, a commander included."
                  )}
                </span>
                <span className="mat-actions">
                  {filledSeeds.length < 5 ? (
                    <button type="button" className="btn" onClick={surprise} disabled={surprising}>
                      {surprising ? "Shuffling…" : filledSeeds.length ? "Fill the rest randomly" : "Surprise me"}
                    </button>
                  ) : null}
                </span>
              </div>
              {!filledSeeds.length && config ? (
                <div className="examples" data-testid="examples">
                  <span className="examples-label">{examples.length === 1 ? "Or watch" : "Or try"}</span>
                  {examples.map((e) => (
                    <button key={e.label} type="button" className="chip chip--example" onClick={() => loadSeeds(e.seeds, e.commander)}>
                      {examples.length === 1 ? "the demo deck: " : ""}
                      {e.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : (
            <section className="mat mat--deck" aria-label="Your decklist">
              <DeckStartPanel
                onComplete={fromDeck("complete")}
                onUpgrade={fromDeck("upgrade")}
                onRead={(r) => {
                  if (r.bracket >= 1 && r.bracket <= 4) setBracket(r.bracket as BracketNumber);
                }}
                blocked={shapeError ? "Fix the deck shape first." : needCode ? "Enter the access code first." : undefined}
              />
            </section>
          )}

          <section className="options" aria-label="Build options">
            {mode === "seeds" ? (
              <div className="opt">
                <span className="opt-label" id="cmd-label">
                  Commander
                </span>
                <p className="opt-value" aria-labelledby="cmd-label">
                  {commander ? (
                    <>
                      <strong>{commander}</strong>{" "}
                      <button type="button" className="link" onClick={() => setCommander(null)}>
                        Let Claude choose
                      </button>
                    </>
                  ) : (
                    <>Claude picks it. To choose yourself, tap the crown on a legendary creature.</>
                  )}
                </p>
              </div>
            ) : null}
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
            {config?.accessCodeRequired && !hasOwn ? (
              <label className="opt">
                <span className="opt-label">Access code</span>
                <input className="field" type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Ask the person who runs this app" autoComplete="off" />
              </label>
            ) : null}
            <details className="more" open={moreSet > 0 || !!shapeError || undefined} data-testid="more-options">
              <summary>
                More options {moreSet ? <span className="pill">{moreSet} set</span> : <span className="opt-summary-hint">wishes, deck shape, your collection</span>}
              </summary>
              <div className="more-body">
                <label className="opt">
                  <span className="opt-label">Anything else?</span>
                  <input className="field" value={theme} maxLength={300} onChange={(e) => setTheme(e.target.value)} placeholder="For example: lots of tokens, no infinite combos, flavor over power" />
                </label>
                <DeckShapeFields value={shape} onChange={setShape} />
                <CollectionPanel value={collection} onChange={setCollection} inactive={access === "demo" ? "The demo deck ignores your collection." : undefined} />
              </div>
            </details>
          </section>

          <div className="go">
            {mode === "seeds" ? (
              <button type="button" className="btn btn--big btn--brass" onClick={build} disabled={!ready || !!needCode || (!!blocked && !hasOwn)} data-testid="build">
                Build my deck
              </button>
            ) : null}
            <BuildStatus config={config} access={access} keyState={key} free={free} onSheet={openSheet} deckMode={mode === "deck"} />
            {goHint ? <p className="go-hint">{goHint}</p> : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          {hasDecks ? (
            <p className="all-decks">
              <a href="/decks">All your decks</a>
            </p>
          ) : null}
        </main>
      ) : null}

      {phase === "forging" ? (
        <main>
          <ForgeView log={log} draft={draft} commander={draftCmd} filled={filled} elapsed={elapsed} onCancel={cancel} spend={usage && usage.model !== "demo" && hasOwn ? spendText(usage.usage, usage.model) : undefined} />
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </main>
      ) : null}

      {phase === "result" && result ? (
        <main>
          {localSave && saveAsk === "ask" && acct.enabled && !acct.user && localSave.name === result.deck.name ? (
            <div className="save-ask" data-testid="save-ask">
              <p>
                <strong>Keep this deck?</strong> It&apos;s saved in this browser only. A free account keeps it on every device: no password, just your email.
              </p>
              <span className="save-ask-actions">
                <button
                  type="button"
                  className="btn btn--brass"
                  onClick={() => {
                    saveAfterLogin.set([localSave.id]);
                    setSaveAsk("login");
                  }}
                  data-testid="save-to-account"
                >
                  Save to my account
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setSaveAsk("dismissed")}>
                  Not now
                </button>
              </span>
            </div>
          ) : null}
          {result.swaps ? <UpgradeSummary swaps={result.swaps} /> : null}
          <DeckView
            deck={result.deck}
            validation={result.validation}
            added={result.swaps?.map((s) => s.in)}
            onRestart={restart}
            onRebuild={ready ? build : undefined}
            spend={result.model ? (result.free ? `Free build with ${modelInfo(result.model)?.label ?? result.model}` : result.usage ? `Built with ${modelInfo(result.model)?.label ?? result.model}: ${spendText(result.usage, result.model)}` : undefined) : undefined}
            donationUrl={config?.donationUrl ?? undefined}
          />
        </main>
      ) : null}

      <LoginDialog
        open={saveAsk === "login"}
        onClose={() => setSaveAsk("ask")}
        title="Save your deck"
        lead="Log in, or make an account with just your email. Your deck moves into it, and you'll find it under My decks."
        next="/decks"
      />

      <KeySheet
        open={!!sheet}
        lead={sheet?.lead}
        value={key}
        onChange={setKey}
        onClose={() => {
          pending.current = null;
          setSheet(null);
        }}
        onDone={keyDone}
        canSave={!!config?.keyVault && !!acct.user}
      />

      {/* the bot check for free builds: on every screen, so "Build another version" has a token too */}
      {config?.freeBuilds && !hasOwn ? <div className="human-check">{human.widget}</div> : null}

      <footer className="foot">
        <p>
          Hundredfoldz is unofficial Fan Content permitted under the <a href="https://company.wizards.com/en/legal/fancontentpolicy">Fan Content Policy</a>. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data and images via <a href="https://scryfall.com">Scryfall</a>. Free and open source: <a href="https://github.com/M-Sahin/mtg-master">built on the mtg-master Claude skill</a>
          {config?.skillVersion ? ` (v${config.skillVersion})` : ""}.
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

"use client";
// "Use your own Claude API key": guided setup, key check, remember/forget, model picker.
// Lives in the key sheet (BuildAccess): the setup page itself only shows a one-line status.
import { useEffect, useState, type ReactNode } from "react";
import { checkKey, keyStore } from "../lib/client/api";
import { DEFAULT_MODEL, MODELS, modelInfo } from "../lib/shared/models";

export interface KeyState {
  key: string; // "" = no key
  model: string;
}

const MODEL_NAME = "hundredfold:model";
const CHECKED = "hundredfold:key-checked"; // per tab: don't re-check the same key on every reload

type ModelList = { id: string; name: string }[];

function cachedModels(key: string): ModelList | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(CHECKED) ?? "null");
    return c && c.tail === key.slice(-10) && Date.now() - c.at < 6 * 3_600_000 ? c.models : null;
  } catch {
    return null;
  }
}
function cacheModels(key: string, models: ModelList) {
  try {
    sessionStorage.setItem(CHECKED, JSON.stringify({ tail: key.slice(-10), at: Date.now(), models }));
  } catch {}
}

/** The model to use: the saved choice if the key can use it, else Sonnet, else the key's first model. */
function fitModel(wanted: string, list: ModelList): string {
  if (list.some((m) => m.id === wanted)) return wanted;
  if (list.some((m) => m.id === DEFAULT_MODEL)) return DEFAULT_MODEL;
  return list[0]?.id ?? DEFAULT_MODEL;
}

export function KeyPanel({ value, onChange, lead, onDone }: { value: KeyState; onChange: (v: KeyState) => void; lead?: ReactNode; onDone?: () => void }) {
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [forgotten, setForgotten] = useState(false);

  // load a remembered key and model once
  useEffect(() => {
    const saved = keyStore.get();
    let model = DEFAULT_MODEL;
    try {
      model = localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
    } catch {}
    if (saved) {
      setRemember(saved.remember);
      const cached = cachedModels(saved.key);
      const apply = (list: ModelList) => {
        setModels(list);
        onChange({ key: saved.key, model: fitModel(model, list) });
      };
      onChange({ key: saved.key, model });
      if (cached) apply(cached);
      else
        checkKey(saved.key)
          .then((list) => {
            cacheModels(saved.key, list);
            apply(list);
          })
          .catch((e) => setError((e as Error).message));
    } else onChange({ key: "", model });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const use = async () => {
    const key = draft.trim();
    if (!key) return;
    setChecking(true);
    setError(null);
    try {
      const list = await checkKey(key);
      setModels(list);
      cacheModels(key, list);
      keyStore.set(key, remember);
      setForgotten(false);
      onChange({ key, model: fitModel(value.model, list) });
      setDraft("");
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const forget = () => {
    keyStore.forget();
    setForgotten(true);
    try {
      sessionStorage.removeItem(CHECKED);
    } catch {}
    setModels(null);
    setError(null);
    onChange({ key: "", model: value.model });
  };

  const pickModel = (model: string) => {
    try {
      localStorage.setItem(MODEL_NAME, model);
    } catch {}
    onChange({ ...value, model });
  };

  const available = models ?? [];
  const recommended = MODELS.filter((m) => !models || available.some((a) => a.id === m.id));
  const others = available.filter((a) => !MODELS.some((m) => m.id === a.id));
  const chosen = modelInfo(value.model);

  if (value.key) {
    return (
      <section className="keypanel" aria-label="Your Claude API key">
        <div className="panel-head">
          <h3>Your Claude API key</h3>
          <span className={`pill ${error ? "pill--warn" : "pill--ok"}`}>{error ? "Check failed" : models ? "Key works" : "Checking…"}</span>
        </div>
        <p className="panel-sub">
          Key ending in <code>…{value.key.slice(-4)}</code>, {remember ? "remembered on this device" : "kept for this tab only"}. It goes with each build and is never stored on the server.{" "}
          <button type="button" className="link" onClick={forget}>
            Forget key
          </button>
        </p>
        {error ? <p className="error">{error}</p> : null}
        <label className="opt">
          <span className="opt-label">Model</span>
          <select className="field" value={value.model} onChange={(e) => pickModel(e.target.value)}>
            {recommended.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {showAll || (!recommended.some((m) => m.id === value.model) && others.some((o) => o.id === value.model))
              ? others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              : null}
          </select>
          <span className="opt-hint">
            {chosen?.hint ?? "No cost estimate for this model."}
            {others.length && !showAll ? (
              <>
                {" "}
                <button type="button" className="link" onClick={() => setShowAll(true)}>
                  Show all {available.length} models
                </button>
              </>
            ) : null}
          </span>
        </label>
      </section>
    );
  }

  return (
    <section className="keypanel" aria-label="Use your own Claude API key">
      <div className="panel-head">
        <h3>Use your own Claude API key</h3>
      </div>
      <p className="panel-sub">{lead ?? "Builds run on your key, on any Claude model, and you pay Anthropic directly: a few cents to about 50 cents a deck. The key stays in your browser."}</p>
      <button type="button" className="link" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
        {help ? "Hide the steps" : "How do I get a key? (about 2 minutes)"}
      </button>
      {help ? (
        <ol className="keysteps">
          <li>
            Sign in to the <a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer">Claude Console</a>. It&apos;s a separate account from a Claude.ai subscription.
          </li>
          <li>
            Create a workspace for this (say &ldquo;Hundredfoldz&rdquo;) with a <strong>monthly spend limit</strong>. A key from that workspace can never cost more than that.
          </li>
          <li>Add a little credit under Billing if your account has none.</li>
          <li>
            Create an API key in that workspace and <strong>save it in your password manager</strong>: the Console shows it only once. Paste it here.
          </li>
        </ol>
      ) : null}
      {/* A login-style form, so the browser's password manager offers to save the key and fills it in
          next time (also after clearing the cache, and on other devices). Nothing is submitted anywhere:
          the key is only checked with Anthropic through /api/key/check. */}
      <form
        className="keyform"
        autoComplete="on"
        onSubmit={(e) => {
          e.preventDefault();
          void use();
        }}
      >
        <input className="visually-hidden" type="text" name="username" autoComplete="username" value="Claude API key" readOnly tabIndex={-1} aria-hidden="true" />
        <div className="keyrow">
          <input
            className="field"
            type="password"
            name="password"
            id="claude-api-key"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="current-password"
            spellCheck={false}
            aria-label="Claude API key"
            data-testid="api-key"
          />
          <button type="submit" className="btn btn--brass" disabled={!draft.trim() || checking}>
            {checking ? "Checking…" : "Use this key"}
          </button>
        </div>
      </form>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it on this device
      </label>
      {forgotten ? <p className="opt-hint">Removed from this browser. If you saved it in your password manager, it&apos;s still there.</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

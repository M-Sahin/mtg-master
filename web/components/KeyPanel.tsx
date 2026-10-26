"use client";
// "Use your own Claude API key": guided setup, key check, remember/forget, model picker.
// Lives in the key sheet (BuildAccess): the setup page itself only shows a one-line status.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkKey, keyStore } from "../lib/client/api";
import { savedKey } from "../lib/client/account";
import { DEFAULT_MODEL, MODELS, modelInfo } from "../lib/shared/models";

export interface KeyState {
  key: string; // "" = no key in this browser
  model: string;
  /** A key saved to the account (sealed on the server): only its last four characters are here. */
  saved?: { last4: string };
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

export function KeyPanel({ value, onChange, lead, onDone, canSave = false }: { value: KeyState; onChange: (v: KeyState) => void; lead?: ReactNode; onDone?: () => void; canSave?: boolean }) {
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const [toAccount, setToAccount] = useState(true); // save a new key to the account (when logged in)
  const [savingAcct, setSavingAcct] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  // logged in: a key saved to the account is used when this browser has none
  useEffect(() => {
    if (!canSave) {
      // logged out: the account's key isn't available anymore
      if (valueRef.current.saved) onChange({ key: valueRef.current.key, model: valueRef.current.model });
      return;
    }
    let live = true;
    savedKey
      .get()
      .then((r) => {
        const v = valueRef.current;
        if (!live || !r.saved || !r.last4 || v.key) return;
        onChange({ key: "", model: r.model && MODELS.some((m) => m.id === r.model) ? r.model : v.model || DEFAULT_MODEL, saved: { last4: r.last4 } });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave]);

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
      if (canSave && toAccount) {
        // checked with Anthropic and sealed on the server; this browser keeps only the last four characters
        const r = await savedKey.save(key, value.model || DEFAULT_MODEL);
        const model = fitModel(value.model || DEFAULT_MODEL, r.models);
        if (model !== r.model) void savedKey.setModel(model).catch(() => {});
        keyStore.forget();
        setModels(r.models);
        onChange({ key: "", model, saved: { last4: r.last4 } });
        setDraft("");
        onDone?.();
        return;
      }
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
    if (value.saved && !value.key) void savedKey.setModel(model).catch(() => {});
    onChange({ ...value, model });
  };

  /** A key from this browser into the account. */
  const moveToAccount = async () => {
    setSavingAcct(true);
    setError(null);
    try {
      const r = await savedKey.save(value.key, value.model);
      keyStore.forget();
      onChange({ key: "", model: value.model, saved: { last4: r.last4 } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingAcct(false);
    }
  };
  const removeSaved = async () => {
    setError(null);
    try {
      await savedKey.remove();
      onChange({ key: "", model: value.model });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const available = models ?? [];
  const recommended = MODELS.filter((m) => !models || available.some((a) => a.id === m.id));
  const others = available.filter((a) => !MODELS.some((m) => m.id === a.id));
  const chosen = modelInfo(value.model);

  if (value.saved && !value.key) {
    return (
      <section className="keypanel" aria-label="Your Claude API key">
        <div className="panel-head">
          <h3>Your Claude API key</h3>
          <span className="pill pill--ok">Saved to your account</span>
        </div>
        <p className="panel-sub">
          Key ending in <code>…{value.saved.last4}</code>. It&apos;s stored encrypted with your account and used on every device you log in on; it never comes back to the browser.{" "}
          <button type="button" className="link" onClick={() => void removeSaved()} data-testid="remove-saved-key">
            Remove it from my account
          </button>
        </p>
        {error ? <p className="error">{error}</p> : null}
        <label className="opt">
          <span className="opt-label">Model</span>
          <select className="field" value={value.model} onChange={(e) => pickModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="opt-hint">{chosen?.hint ?? "No cost estimate for this model."}</span>
        </label>
      </section>
    );
  }

  if (value.key) {
    return (
      <section className="keypanel" aria-label="Your Claude API key">
        <div className="panel-head">
          <h3>Your Claude API key</h3>
          <span className={`pill ${error ? "pill--warn" : "pill--ok"}`}>{error ? "Check failed" : models ? "Key works" : "Checking…"}</span>
        </div>
        <p className="panel-sub">
          Key ending in <code>…{value.key.slice(-4)}</code>, {remember ? "remembered on this device" : "kept for this tab only"}. It goes with each build and isn&apos;t stored on the server.{" "}
          <button type="button" className="link" onClick={forget}>
            Forget key
          </button>
        </p>
        {canSave ? (
          <p className="panel-sub">
            <button type="button" className="btn btn--small" onClick={() => void moveToAccount()} disabled={savingAcct} data-testid="key-to-account">
              {savingAcct ? "Saving…" : "Save it to my account"}
            </button>{" "}
            so it works on every device you log in on.
          </p>
        ) : null}
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
      {canSave ? (
        <label className="check">
          <input type="checkbox" checked={toAccount} onChange={(e) => setToAccount(e.target.checked)} data-testid="save-key-to-account" /> Save it to my account (encrypted), so every device I log in on can use it
        </label>
      ) : null}
      {!canSave || !toAccount ? (
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it on this device
        </label>
      ) : null}
      {forgotten ? <p className="opt-hint">Removed from this browser. If you saved it in your password manager, it&apos;s still there.</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

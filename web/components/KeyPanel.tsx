"use client";
// "Use your own Claude API key": guided setup, key check, remember/forget, model picker.
import { useEffect, useState } from "react";
import { checkKey, keyStore } from "../lib/client/api";
import { DEFAULT_MODEL, MODELS, modelInfo } from "../lib/shared/models";

export interface KeyState {
  key: string; // "" = no key
  model: string;
}

const MODEL_NAME = "hundredfold:model";

export function KeyPanel({ value, onChange, serverKey }: { value: KeyState; onChange: (v: KeyState) => void; serverKey: boolean }) {
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [help, setHelp] = useState(!serverKey);

  // load a remembered key and model once
  useEffect(() => {
    const saved = keyStore.get();
    let model = DEFAULT_MODEL;
    try {
      model = localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
    } catch {}
    if (saved) {
      setRemember(saved.remember);
      onChange({ key: saved.key, model });
      checkKey(saved.key)
        .then(setModels)
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
      keyStore.set(key, remember);
      const model = list.some((m) => m.id === value.model) ? value.model : list.some((m) => m.id === DEFAULT_MODEL) ? DEFAULT_MODEL : list[0]?.id ?? DEFAULT_MODEL;
      onChange({ key, model });
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const forget = () => {
    keyStore.forget();
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
      <section className="panel keypanel" aria-label="Your Claude API key">
        <div className="panel-head">
          <h3>Your Claude API key</h3>
          <span className={`pill ${error ? "pill--warn" : "pill--ok"}`}>{error ? "Check failed" : models ? "Key works" : "Checking…"}</span>
        </div>
        <p className="panel-sub">
          Key ending in <code>…{value.key.slice(-4)}</code>, {remember ? "remembered on this device" : "kept for this tab only"}. It's sent with each build and never stored on the server.{" "}
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
    <section className="panel keypanel" aria-label="Use your own Claude API key">
      <div className="panel-head">
        <h3>Use your own Claude API key</h3>
      </div>
      <p className="panel-sub">
        {serverKey ? "Or skip the access code: builds" : "Builds"} run on your own Claude API key, so you pay Anthropic directly for what you use. After each build you see the tokens it used and an estimate of the cost. The key stays in your browser; the server uses it for your build and doesn't keep it.
      </p>
      <button type="button" className="link" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
        {help ? "Hide the setup steps" : "How do I get a key? (about 2 minutes)"}
      </button>
      {help ? (
        <ol className="keysteps">
          <li>
            Sign in to the <a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer">Claude Console</a> (a separate account from a Claude.ai subscription).
          </li>
          <li>
            Create a workspace just for this, for example &ldquo;Hundredfold&rdquo;, and give it a <strong>monthly spend limit</strong>. A key from that workspace can never cost more than the limit you chose.
          </li>
          <li>Add a little credit under Billing if your account has none.</li>
          <li>In that workspace, create an API key and paste it here.</li>
        </ol>
      ) : null}
      <div className="keyrow">
        <input
          className="field"
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && use()}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Claude API key"
          data-testid="api-key"
        />
        <button type="button" className="btn btn--brass" onClick={use} disabled={!draft.trim() || checking}>
          {checking ? "Checking…" : "Use this key"}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it on this device (otherwise only for this tab)
      </label>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

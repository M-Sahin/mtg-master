"use client";
// Log in with an email link, Discord or Google. Accounts are optional: everything works without one.
import { useState } from "react";
import { account, herePath, useAccount } from "../lib/client/account";
import { useHumanCheck } from "./useHumanCheck";

const PROVIDER_LABEL: Record<string, string> = { discord: "Log in with Discord", google: "Log in with Google" };

export function LoginForm({ next }: { next?: string }) {
  const acct = useAccount();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = next ?? herePath();
  const human = useHumanCheck("login");
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await account.sendLink(email.trim(), back, await human.take());
      setSent(email.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const oauth = acct.providers.filter((p) => p !== "email");
  return (
    <div className="login" data-testid="login-form">
      {oauth.length ? (
        <div className="login-providers">
          {oauth.map((p) => (
            <a key={p} className={`btn login-${p}`} href={account.oauthHref(p, back)}>
              {PROVIDER_LABEL[p] ?? p}
            </a>
          ))}
        </div>
      ) : null}
      {acct.providers.includes("email") || !acct.providers.length ? (
        sent ? (
          <p className="login-sent" role="status">
            We sent a login link to <strong>{sent}</strong>. Open it <strong>in this browser</strong> to log in. It can take a minute; check your spam folder too.
          </p>
        ) : (
          <form
            className="login-email"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email address" data-testid="login-email" />
            <button type="submit" className="btn btn--brass" disabled={busy || !email.trim() || !human.ready}>
              {busy ? "Sending…" : human.ready ? "Email me a login link" : "One moment…"}
            </button>
            {human.widget}
          </form>
        )
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <p className="opt-hint">
        No password. An account keeps your decks on every device; everything else works without one. We store your email and your decks, nothing else. <a href="/privacy">Privacy</a>
      </p>
    </div>
  );
}

"use client";
// /account: who you're logged in as, log out, delete the account. Logged out: the login form.
import { useEffect, useState } from "react";
import { account, useAccount } from "../lib/client/account";
import { LoginForm } from "./LoginForm";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

const LOGIN_ERRORS: Record<string, string> = {
  expired: "That login link has expired or was already used. Ask for a new one.",
  "other-browser": "Open the login link in the same browser where you asked for it. Ask for a new link here.",
  failed: "Logging in didn't work. Try again.",
};

export default function AccountPage() {
  const acct = useAccount();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    const why = new URLSearchParams(window.location.search).get("login");
    if (why) setLoginError(LOGIN_ERRORS[why] ?? LOGIN_ERRORS.failed);
  }, []);

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await account.deleteAccount();
      setDeleted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <SiteHeader active={null} />
      <main className="account-page">
        <h1>Your account</h1>
        {!acct.loaded ? <p className="panel-sub">Loading…</p> : null}
        {acct.loaded && !acct.enabled ? <p className="panel-sub">This copy of Hundredfoldz has no accounts. Your decks are kept in this browser under My decks.</p> : null}
        {deleted ? <p className="panel-sub" role="status">Your account and every deck in it are deleted.</p> : null}
        {acct.loaded && acct.enabled && !acct.user && !deleted ? (
          <section className="panel">
            <h3>Log in</h3>
            {loginError ? <p className="error">{loginError}</p> : null}
            <LoginForm next="/decks" />
          </section>
        ) : null}
        {acct.user ? (
          <>
            <section className="panel" data-testid="account-info">
              <h3>{acct.user.name}</h3>
              <p className="panel-sub">
                Logged in {acct.user.email ? `as ${acct.user.email}` : ""} with {acct.user.provider === "email" ? "an email link" : acct.user.provider[0].toUpperCase() + acct.user.provider.slice(1)}. Your decks are saved to this account, so they're on every device you log in on.
              </p>
              <div className="deck-actions">
                <a className="btn btn--brass" href="/decks">
                  My decks
                </a>
                <button type="button" className="btn" onClick={() => void account.logout()}>
                  Log out
                </button>
              </div>
            </section>
            <section className="panel account-danger">
              <h3>Delete your account</h3>
              <p className="panel-sub">This deletes your account and every deck saved in it, right away. It can&apos;t be undone. Decks you shared by link keep working.</p>
              <label className="opt">
                <span className="opt-label">Type delete to confirm</span>
                <input className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" data-testid="delete-confirm" />
              </label>
              <button type="button" className="btn btn--danger" disabled={confirm.trim().toLowerCase() !== "delete" || busy} onClick={() => void del()}>
                {busy ? "Deleting…" : "Delete my account"}
              </button>
              {error ? <p className="error">{error}</p> : null}
            </section>
          </>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}

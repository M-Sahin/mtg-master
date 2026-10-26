"use client";
// The navbar's login / account button. Hidden when the site has no accounts.
import { useState } from "react";
import { useAccount } from "../lib/client/account";
import { LoginDialog } from "./LoginDialog";

export function AccountButton({ onNavigate }: { onNavigate?: () => void }) {
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  if (!acct.loaded || !acct.enabled) return null;
  if (acct.user) {
    return (
      <a className="nav-link nav-account" href="/account" onClick={onNavigate} title={acct.user.email ?? acct.user.name} data-testid="nav-account">
        <span className="nav-avatar" aria-hidden>
          {acct.user.name.slice(0, 1).toUpperCase()}
        </span>
        Account
      </a>
    );
  }
  return (
    <>
      <button type="button" className="nav-link nav-login" onClick={() => setOpen(true)} data-testid="nav-login">
        Log in
      </button>
      <LoginDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

"use client";
// The navbar's login / account button. Hidden when the site has no accounts.
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/client/account";
import { LoginForm } from "./LoginForm";

export function AccountButton({ onNavigate }: { onNavigate?: () => void }) {
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
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
      <dialog ref={ref} className="modal login-modal" onClose={() => setOpen(false)} onClick={(e) => e.target === ref.current && setOpen(false)} aria-label="Log in">
        <div className="modal-inner login-inner">
          <h3>Log in to Hundredfoldz</h3>
          <LoginForm />
          <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

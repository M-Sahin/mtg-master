"use client";
// The login dialog: the navbar's "Log in", and "Save to my account" under a finished deck.
import { useEffect, useRef } from "react";
import { LoginForm } from "./LoginForm";

export function LoginDialog({ open, onClose, title = "Log in to Hundredfoldz", lead, next }: { open: boolean; onClose: () => void; title?: string; lead?: string; next?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal login-modal" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={title}>
      {open ? (
        <div className="modal-inner login-inner">
          <h3>{title}</h3>
          {lead ? <p className="panel-sub">{lead}</p> : null}
          <LoginForm next={next} />
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
    </dialog>
  );
}

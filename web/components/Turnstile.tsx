"use client";
// The Cloudflare Turnstile widget. Usually invisible ("interaction-only"): it only shows itself
// when Cloudflare wants a click. Calls onToken with a fresh token, or null when it expires.
// Change resetKey to get a new token after one was used (each token works once).
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  // added by our own (nonce'd) script, so the security policy's 'strict-dynamic' allows it
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Turnstile didn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile({ siteKey, action, onToken, resetKey = 0 }: { siteKey: string; action: string; onToken: (token: string | null) => void; resetKey?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let live = true;
    loadScript()
      .then(() => {
        if (!live || !el.current || !window.turnstile) return;
        id.current = window.turnstile.render(el.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          appearance: "interaction-only",
          callback: (t: string) => cb.current(t),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      live = false;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (!resetKey || !id.current || !window.turnstile) return;
    cb.current(null);
    window.turnstile.reset(id.current);
  }, [resetKey]);

  return <div ref={el} className="turnstile" data-testid="turnstile" />;
}

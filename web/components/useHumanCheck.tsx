"use client";
// The bot check for a form: renders the Turnstile widget when the site has it on, and hands
// out one fresh token per submit (each token works once). Without Turnstile it's a no-op.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSiteConfig } from "../lib/client/site-config";
import { Turnstile } from "./Turnstile";

export interface HumanCheck {
  /** the widget (usually invisible), or null when the bot check is off */
  widget: ReactNode;
  /** false while a token is still coming (submit buttons can wait for it) */
  ready: boolean;
  /** a token for one request (undefined when the check is off); call once per submit */
  take: () => Promise<string | undefined>;
}

export function useHumanCheck(action: string): HumanCheck {
  const site = useSiteConfig();
  const siteKey = site?.turnstileSiteKey ?? null;
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const waiters = useRef<((t: string | undefined) => void)[]>([]);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    if (!token) return;
    for (const w of waiters.current.splice(0)) w(token);
  }, [token]);

  const take = useCallback(async () => {
    if (!siteKey) return undefined;
    const t =
      tokenRef.current ??
      (await new Promise<string | undefined>((resolve) => {
        waiters.current.push(resolve);
        setTimeout(() => resolve(undefined), 20_000); // the server explains if it's missing
      }));
    // used: get a new one ready for the next submit
    setToken(null);
    tokenRef.current = null;
    setResetKey((k) => k + 1);
    return t;
  }, [siteKey]);

  return {
    widget: siteKey ? <Turnstile siteKey={siteKey} action={action} onToken={setToken} resetKey={resetKey} /> : null,
    ready: !siteKey || !!token,
    take,
  };
}

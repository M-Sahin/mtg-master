"use client";
// /api/config, fetched once per page load and shared by every component that needs it.
import { useEffect, useState } from "react";
import type { PublicConfig } from "../server/config";

let pending: Promise<PublicConfig | null> | null = null;

export function loadConfig(): Promise<PublicConfig | null> {
  pending ??= fetch("/api/config")
    .then((r) => (r.ok ? (r.json() as Promise<PublicConfig>) : null))
    .catch(() => null);
  return pending;
}

export function useSiteConfig(): PublicConfig | null {
  const [c, setC] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let live = true;
    void loadConfig().then((x) => live && setC(x));
    return () => {
      live = false;
    };
  }, []);
  return c;
}

"use client";

import { useEffect } from "react";

import { authClient } from "./auth-client";
import { useMe } from "./use-me";

const REFRESH_MS = 60_000;

/**
 * Keeps Neon Auth's signed session cache cookie fresh. Our own API routes can read that cookie but
 * not mint it; only the /api/auth proxy does, and only once the old one has expired. Without this a
 * signed-in player's every poll falls through to a Neon Auth lookup after the first few minutes.
 */
export function useSessionRefresh() {
  const signedIn = Boolean(useMe()?.user);
  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void Promise.resolve(authClient.getSession()).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedIn]);
}

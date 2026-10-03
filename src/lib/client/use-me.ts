"use client";

import { useEffect, useState } from "react";

import type { MeResponse } from "@/lib/protocol";

import { api } from "./api";

const listeners = new Set<(me: MeResponse) => void>();
let cached: Promise<MeResponse> | null = null;

function load() {
  cached ??= api.me().catch((error: unknown) => {
    // Show the header without accounts, but log it: a misconfigured deployment (e.g. only one
    // NEON_AUTH_* variable set) otherwise looks exactly like accounts being switched off.
    console.error("GET /api/me failed; hiding account links", error);
    cached = null; // Retry on the next mount instead of caching the failure.
    return { authEnabled: false, user: null };
  });
  return cached;
}

/** Call after signing in or out so every mounted useMe picks up the new account. */
export function invalidateMe() {
  cached = null;
  void load().then((me) => listeners.forEach((l) => l(me)));
}

export function useMe() {
  const [me, setMe] = useState<MeResponse | null>(null);
  useEffect(() => {
    let active = true;
    const listener = (next: MeResponse) => active && setMe(next);
    listeners.add(listener);
    void load().then(listener);
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);
  return me;
}

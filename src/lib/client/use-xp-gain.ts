"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

export type XpGain = { gained: number; after: number; achievements: string[] };

/** The server awards just after the finishing request, so look a few times with growing gaps. */
const DEFAULT_DELAYS_MS = [1_500, 3_000, 6_000] as const;

/**
 * This game's XP, read from the player's history. Silent by design: if it never shows up (guest, old
 * server, network trouble) the results screen simply has no XP line. A field the server omits counts
 * as "not awarded yet".
 */
export function useXpGain(
  code: string,
  enabled: boolean,
  delays: readonly number[] = DEFAULT_DELAYS_MS,
): XpGain | null {
  const [gain, setGain] = useState<XpGain | null>(null);

  useEffect(() => {
    if (!enabled || delays.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (n: number) => {
      try {
        const you = (await api.history()).find((h) => h.code === code)?.you;
        if (typeof you?.xpGained === "number" && typeof you.xpAfter === "number") {
          if (!cancelled)
            setGain({ gained: you.xpGained, after: you.xpAfter, achievements: you.achievements ?? [] });
          return;
        }
      } catch {
        // try again below
      }
      if (!cancelled && n + 1 < delays.length) timer = setTimeout(() => void attempt(n + 1), delays[n + 1]);
    };

    timer = setTimeout(() => void attempt(0), delays[0]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, enabled, delays]);

  return gain;
}

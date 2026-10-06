"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

export type RatingChange = { before: number; after: number };

/** The server rates just after the finishing request, so look a few times with growing gaps. */
const DEFAULT_DELAYS_MS = [1_500, 3_000, 6_000] as const;

/**
 * This game's rating change, read from the player's history. Silent by design: if it never shows
 * up (guest, unrated game, network trouble) the results screen simply has no rating line.
 */
export function useRatingChange(
  code: string,
  enabled: boolean,
  delays: readonly number[] = DEFAULT_DELAYS_MS,
): RatingChange | null {
  const [change, setChange] = useState<RatingChange | null>(null);

  useEffect(() => {
    if (!enabled || delays.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (n: number) => {
      try {
        const you = (await api.history()).find((h) => h.code === code)?.you;
        if (you && you.ratingBefore !== null && you.ratingAfter !== null) {
          if (!cancelled) setChange({ before: you.ratingBefore, after: you.ratingAfter });
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

  return change;
}

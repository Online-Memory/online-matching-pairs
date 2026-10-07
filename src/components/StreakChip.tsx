"use client";

import { useEffect, useRef, useState } from "react";

import { streakTier } from "@/lib/client/streak-tier";

/** A streak this long gets a "broken" moment when it ends. */
const BROKEN_MIN = 3;
const BROKEN_MS = 900;

/**
 * The `xN` badge on a seat. Static information, so it stays under reduced motion; only its shake
 * (CSS) is gated. `playing` is false once the game is over, so the final scores don't "break".
 */
export function StreakChip({ streak, playing }: { streak: number; playing: boolean }) {
  const [broken, setBroken] = useState<number | null>(null);
  const previous = useRef(streak);

  useEffect(() => {
    const before = previous.current;
    previous.current = streak;
    if (!playing || streak >= before || before < BROKEN_MIN) {
      setBroken(null); // a restarted streak or a finished game replaces any broken chip
      return;
    }
    setBroken(before);
    const id = setTimeout(() => setBroken(null), BROKEN_MS);
    return () => clearTimeout(id);
  }, [streak, playing]);

  if (streak >= 2) return <span className="streak-chip" data-tier={streakTier(streak)}>{`x${streak}`}</span>;
  if (broken !== null) return <span className="streak-chip" data-broken="true">{`x${broken}`}</span>;
  return null;
}

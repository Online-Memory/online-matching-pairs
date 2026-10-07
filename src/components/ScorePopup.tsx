"use client";

import type { StreakTier } from "@/lib/client/streak-tier";

type Props = { x: number; y: number; label: string; tier: StreakTier };

/** Floats up from where a pair was matched. Hidden by CSS under reduced motion (the seat chip stays). */
export function ScorePopup({ x, y, label, tier }: Props) {
  return (
    <span
      className="score-popup"
      data-tier={tier}
      data-testid="score-popup"
      style={{ left: x, top: y }}
      aria-hidden
    >
      {label}
    </span>
  );
}

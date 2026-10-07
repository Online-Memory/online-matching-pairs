export type StreakTier = "none" | "warm" | "hot" | "fire";

/** Streak length → how loud the effects are. CSS keys off the tier, never the raw number. */
export function streakTier(streak: number): StreakTier {
  if (streak >= 5) return "fire";
  if (streak >= 3) return "hot";
  if (streak >= 2) return "warm";
  return "none";
}

/** Confetti pieces for a single match at each tier. */
export const BURST_COUNT: Record<StreakTier, number> = { none: 10, warm: 18, hot: 32, fire: 56 };

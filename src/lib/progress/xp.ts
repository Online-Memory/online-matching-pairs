export const XP_PER_PAIR = 10;
export const XP_PER_STREAK_STEP = 5;
export const STREAK_STEP_CAP = 10;
const OTHER_POSITION_XP = 10;
const POSITION_XP: Readonly<Record<number, number>> = { 1: 50, 2: 30, 3: 20 };

export type XpInput = {
  pairs: number;
  bestStreak: number;
  /** Final position; null for a player who left before the end. */
  rank: number | null;
  /** Seated players, guests included: position only counts when someone else was playing. */
  players: number;
};
export type XpBreakdown = { pairs: number; streak: number; position: number; total: number };

/** XP for one player's finished game: matches found, best streak, final position. Pure; shared by server and client. */
export function computeXp({ pairs, bestStreak, rank, players }: XpInput): XpBreakdown {
  const pairsXp = Math.max(0, pairs) * XP_PER_PAIR;
  const streakXp = Math.min(Math.max(0, bestStreak - 1), STREAK_STEP_CAP) * XP_PER_STREAK_STEP;
  const positionXp = players >= 2 && rank !== null ? (POSITION_XP[rank] ?? OTHER_POSITION_XP) : 0;
  return { pairs: pairsXp, streak: streakXp, position: positionXp, total: pairsXp + streakXp + positionXp };
}

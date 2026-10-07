import type { PlayerView } from "@/lib/protocol";

export type Award = "streak" | "flawless" | "dominant";

export const AWARD_LABEL: Record<Award, string> = {
  streak: "Longest streak",
  flawless: "Flawless",
  dominant: "Dominant",
};

const STREAK_MIN = 3;
const FLAWLESS_MIN_PAIRS = 3;

/**
 * Awards for a finished game, from numbers every player already sees. Versus games only: a solo game
 * has nobody to be better than. Keyed by player id; players without an award are absent.
 */
export function computeAwards(players: readonly PlayerView[], totalPairs: number): Record<string, Award[]> {
  if (players.length < 2) return {};
  const longest = Math.max(...players.map((p) => p.bestStreak));
  const out: Record<string, Award[]> = {};
  for (const p of players) {
    const earned: Award[] = [];
    if (longest >= STREAK_MIN && p.bestStreak === longest) earned.push("streak");
    // `moves === pairs` alone is true for someone who never played, hence the minimum.
    if (p.pairs >= FLAWLESS_MIN_PAIRS && p.moves === p.pairs) earned.push("flawless");
    if (p.pairs * 2 > totalPairs) earned.push("dominant");
    if (earned.length > 0) out[p.id] = earned;
  }
  return out;
}

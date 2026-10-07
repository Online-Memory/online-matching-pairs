export type AchievementId =
  "first_game" | "first_win" | "win_10" | "games_50" | "streak_5" | "streak_8" | "flawless";

export type Achievement = { id: AchievementId; title: string; description: string };

/** Display order. Only ids are stored; titles live here so they can change without a migration. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first_game", title: "First game", description: "Finish a game." },
  { id: "first_win", title: "First win", description: "Win a game against other players." },
  { id: "win_10", title: "Ten wins", description: "Win 10 games against other players." },
  { id: "games_50", title: "Veteran", description: "Finish 50 games." },
  { id: "streak_5", title: "Hot streak", description: "Match 5 pairs in a row." },
  { id: "streak_8", title: "Unstoppable", description: "Match 8 pairs in a row." },
  {
    id: "flawless",
    title: "Flawless",
    description: "Play at least 3 pairs without a single miss, against others.",
  },
];

export const achievementById = (id: string): Achievement | undefined => ACHIEVEMENTS.find((a) => a.id === id);

/** What the rules need to know about a player's finished games (see `queryLifetime` on the server). */
export type Lifetime = {
  games: number;
  /** Games won with 2 or more seated players. */
  wins: number;
  /** Best streak across all games. */
  bestStreak: number;
  /** Versus games with at least 3 pairs and no misses. */
  flawless: number;
};

const RULES: Record<AchievementId, (l: Lifetime) => boolean> = {
  first_game: (l) => l.games >= 1,
  first_win: (l) => l.wins >= 1,
  win_10: (l) => l.wins >= 10,
  games_50: (l) => l.games >= 50,
  streak_5: (l) => l.bestStreak >= 5,
  streak_8: (l) => l.bestStreak >= 8,
  flawless: (l) => l.flawless >= 1,
};

/** Everything this player has earned so far, in catalog order. Pure: a function of persisted stats only. */
export function evaluateAchievements(lifetime: Lifetime): AchievementId[] {
  return ACHIEVEMENTS.filter((a) => RULES[a.id](lifetime)).map((a) => a.id);
}

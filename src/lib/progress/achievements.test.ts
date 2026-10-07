import { describe, expect, it } from "vitest";

import { ACHIEVEMENTS, achievementById, evaluateAchievements, type Lifetime } from "./achievements";

const base: Lifetime = { games: 0, wins: 0, bestStreak: 0, flawless: 0 };

describe("evaluateAchievements", () => {
  it("earns nothing with no games", () => {
    expect(evaluateAchievements(base)).toEqual([]);
  });

  it.each([
    [{ games: 1 }, ["first_game"]],
    [{ games: 1, wins: 1 }, ["first_game", "first_win"]],
    [{ games: 12, wins: 10 }, ["first_game", "first_win", "win_10"]],
    [{ games: 50 }, ["first_game", "games_50"]],
    [{ games: 3, bestStreak: 5 }, ["first_game", "streak_5"]],
    [{ games: 3, bestStreak: 8 }, ["first_game", "streak_5", "streak_8"]],
    [{ games: 3, flawless: 1 }, ["first_game", "flawless"]],
  ] as [Partial<Lifetime>, string[]][])("%j earns %j", (over, expected) => {
    expect(evaluateAchievements({ ...base, ...over })).toEqual(expected);
  });

  it("uses the exact thresholds", () => {
    const ids = (over: Partial<Lifetime>) => evaluateAchievements({ ...base, games: 60, ...over });
    expect(ids({ wins: 9 })).not.toContain("win_10");
    expect(ids({ wins: 10 })).toContain("win_10");
    expect(ids({ bestStreak: 4 })).not.toContain("streak_5");
    expect(ids({ bestStreak: 7 })).not.toContain("streak_8");
    expect(evaluateAchievements({ ...base, games: 49 })).not.toContain("games_50");
  });
});

describe("catalog", () => {
  it("has seven uniquely identified, described achievements", () => {
    expect(ACHIEVEMENTS).toHaveLength(7);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(7);
    for (const a of ACHIEVEMENTS) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it("looks achievements up by id and ignores unknown ids", () => {
    expect(achievementById("flawless")?.title).toBe("Flawless");
    expect(achievementById("from_the_future")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { computeXp } from "./xp";

describe("computeXp", () => {
  it("scores the spec's example: an 8-pair win with a best streak of 4", () => {
    expect(computeXp({ pairs: 8, bestStreak: 4, rank: 1, players: 2 })).toEqual({
      pairs: 80,
      streak: 15,
      position: 50,
      total: 145,
    });
  });

  it.each([
    [1, 50],
    [2, 30],
    [3, 20],
    [4, 10],
    [9, 10],
  ])("rank %i in a versus game earns %i position XP", (rank, position) => {
    expect(computeXp({ pairs: 0, bestStreak: 0, rank, players: 4 }).position).toBe(position);
  });

  it("earns no position XP alone, or without a rank", () => {
    expect(computeXp({ pairs: 8, bestStreak: 0, rank: 1, players: 1 }).position).toBe(0);
    expect(computeXp({ pairs: 3, bestStreak: 0, rank: null, players: 3 })).toMatchObject({
      position: 0,
      total: 30,
    });
  });

  it("pays 5 per step above a streak of 1, capped at 10 steps", () => {
    const streak = (bestStreak: number) => computeXp({ pairs: 0, bestStreak, rank: null, players: 1 }).streak;
    expect([0, 1, 2, 3, 11, 12, 40].map(streak)).toEqual([0, 0, 5, 10, 50, 50, 50]);
  });

  it("never goes negative on odd input", () => {
    expect(computeXp({ pairs: 0, bestStreak: -3, rank: null, players: 0 }).total).toBe(0);
  });
});

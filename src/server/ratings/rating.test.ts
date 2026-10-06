import { describe, expect, it } from "vitest";

import { computeRatings, K_ESTABLISHED, pairKey, repeatWeight, type RatingInput } from "./rating";

const p = (userId: string, rank: number, rating = 1000, ratedGames = 20): RatingInput => ({
  userId,
  rank,
  rating,
  ratedGames,
});
const byId = (results: ReturnType<typeof computeRatings>, id: string) =>
  results.find((r) => r.userId === id)!;

describe("computeRatings", () => {
  it("moves equal established players by K/2 each way", () => {
    const r = computeRatings([p("a", 1), p("b", 2)]);
    expect(byId(r, "a")).toMatchObject({ delta: 16, newRating: 1016, won: true });
    expect(byId(r, "b")).toMatchObject({ delta: -16, newRating: 984, won: false });
  });

  it("leaves equal players alone on a tie, and both win", () => {
    const r = computeRatings([p("a", 1), p("b", 1)]);
    expect(r.map((x) => x.delta)).toEqual([0, 0]);
    expect(r.every((x) => x.won)).toBe(true);
  });

  it("uses the larger K while a player is provisional", () => {
    const r = computeRatings([p("a", 1, 1000, 0), p("b", 2, 1000, 0)]);
    expect(byId(r, "a").delta).toBe(24);
    expect(byId(r, "b").delta).toBe(-24);
  });

  it("rewards an upset more than an expected win", () => {
    const upset = computeRatings([p("low", 1, 900), p("high", 2, 1100)]);
    const expected = computeRatings([p("high", 1, 1100), p("low", 2, 900)]);
    expect(byId(upset, "low").delta).toBe(24);
    expect(byId(expected, "high").delta).toBe(8);
  });

  it("keeps a 12-player game within K and roughly zero-sum", () => {
    const players = Array.from({ length: 12 }, (_, i) => p(`u${i}`, i + 1));
    const r = computeRatings(players);
    expect(byId(r, "u0").delta).toBe(16);
    expect(byId(r, "u11").delta).toBe(-16);
    expect(r.every((x) => Math.abs(x.delta) <= K_ESTABLISHED)).toBe(true);
    expect(Math.abs(r.reduce((sum, x) => sum + x.delta, 0))).toBeLessThanOrEqual(6);
  });

  it("damps a repeated pairing and never below the minimum weight", () => {
    expect(repeatWeight(0)).toBe(1);
    expect(repeatWeight(1)).toBe(0.75);
    expect(repeatWeight(2)).toBe(0.5);
    expect(repeatWeight(3)).toBe(0.25);
    expect(repeatWeight(9)).toBe(0.25);
    const r = computeRatings([p("a", 1), p("b", 2)], new Map([[pairKey("b", "a"), 1]]));
    expect(byId(r, "a").delta).toBe(12);
    expect(byId(r, "b").delta).toBe(-12);
  });

  it("never drops a rating below the floor", () => {
    const r = computeRatings([p("a", 1, 110), p("b", 2, 110)]);
    expect(byId(r, "b")).toMatchObject({ newRating: 100, delta: -10 });
  });

  it("returns a lone player unchanged", () => {
    expect(computeRatings([p("a", 1)])).toEqual([{ userId: "a", newRating: 1000, delta: 0, won: false }]);
  });
});

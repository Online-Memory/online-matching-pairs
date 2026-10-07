import { describe, expect, it } from "vitest";

import { BURST_COUNT, streakTier } from "./streak-tier";

describe("streakTier", () => {
  it.each([
    [-1, "none"],
    [0, "none"],
    [1, "none"],
    [2, "warm"],
    [3, "hot"],
    [4, "hot"],
    [5, "fire"],
    [12, "fire"],
  ] as const)("streak %i is %s", (streak, tier) => {
    expect(streakTier(streak)).toBe(tier);
  });

  it("bursts grow with the tier", () => {
    expect(BURST_COUNT.none).toBeLessThan(BURST_COUNT.warm);
    expect(BURST_COUNT.warm).toBeLessThan(BURST_COUNT.hot);
    expect(BURST_COUNT.hot).toBeLessThan(BURST_COUNT.fire);
  });
});

import { describe, expect, it } from "vitest";

import { TIER_LABEL, TIER_ORDER, tierForRating, tierRank } from "./tiers";

describe("tierForRating", () => {
  it.each([
    [100, "bronze"],
    [899, "bronze"],
    [900, "silver"],
    [1000, "silver"],
    [1099, "silver"],
    [1100, "gold"],
    [1299, "gold"],
    [1300, "platinum"],
    [1499, "platinum"],
    [1500, "diamond"],
    [2400, "diamond"],
  ] as const)("rating %i is %s", (rating, tier) => {
    expect(tierForRating(rating).tier).toBe(tier);
  });

  it("reports the next tier and progress through the current one", () => {
    expect(tierForRating(1000)).toMatchObject({ tier: "silver", next: "gold", progress: 0.5 });
    expect(tierForRating(900).progress).toBe(0);
    expect(tierForRating(1500)).toMatchObject({ tier: "diamond", next: null, progress: 1 });
  });

  it("keeps progress within 0 to 1", () => {
    for (const r of [0, 100, 899, 1099, 1499, 5000]) {
      const { progress } = tierForRating(r);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("tier helpers", () => {
  it("ranks tiers from lowest to highest and labels each", () => {
    expect(TIER_ORDER.map(tierRank)).toEqual([0, 1, 2, 3, 4]);
    expect(tierRank("gold")).toBeGreaterThan(tierRank("silver"));
    expect(TIER_LABEL.platinum).toBe("Platinum");
  });
});

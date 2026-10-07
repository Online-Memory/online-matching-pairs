import { describe, expect, it } from "vitest";

import { levelForXp, xpForLevel } from "./levels";

describe("levels", () => {
  it("needs 50 * L * (L - 1) XP in total to reach level L", () => {
    expect([1, 2, 3, 4, 5, 10].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000, 4500]);
  });

  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [999, 4],
    [1000, 5],
    [4499, 9],
    [4500, 10],
    [-5, 1],
  ])("%i XP is level %i", (xp, level) => {
    expect(levelForXp(xp).level).toBe(level);
  });

  it("reports progress inside the level", () => {
    expect(levelForXp(150)).toEqual({ level: 2, xpIntoLevel: 50, xpForNext: 200 });
    expect(levelForXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 100 });
  });
});

import { describe, expect, it } from "vitest";

import { GUEST_MAX_PLAYERS, handleSchema, MAX_PLAYERS, maxPlayersFor } from ".";

describe("maxPlayersFor", () => {
  it("caps guests at 4 and signed-in hosts at 12", () => {
    expect(GUEST_MAX_PLAYERS).toBe(4);
    expect(MAX_PLAYERS).toBe(12);
    expect(maxPlayersFor(false)).toBe(GUEST_MAX_PLAYERS);
    expect(maxPlayersFor(true)).toBe(MAX_PLAYERS);
  });
});

describe("handleSchema", () => {
  it("normalises @, case and surrounding spaces", () => {
    expect(handleSchema.parse("  @Sonny_1 ")).toBe("sonny_1");
  });

  it("rejects too short, too long and odd characters", () => {
    for (const bad of ["ab", "a".repeat(21), "has space", "emoji😀", "@@sonny", ""]) {
      expect(handleSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

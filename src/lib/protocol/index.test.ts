import { describe, expect, it } from "vitest";

import { GUEST_MAX_PLAYERS, MAX_PLAYERS, maxPlayersFor } from ".";

describe("maxPlayersFor", () => {
  it("caps guests at 4 and signed-in hosts at 12", () => {
    expect(GUEST_MAX_PLAYERS).toBe(4);
    expect(MAX_PLAYERS).toBe(12);
    expect(maxPlayersFor(false)).toBe(GUEST_MAX_PLAYERS);
    expect(maxPlayersFor(true)).toBe(MAX_PLAYERS);
  });
});

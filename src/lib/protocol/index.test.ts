import { describe, expect, it } from "vitest";

import { createTableRequestSchema, GUEST_MAX_PLAYERS, MAX_PLAYERS, maxPlayersFor } from ".";

describe("maxPlayersFor", () => {
  it("caps guests at 4 and signed-in hosts at 12", () => {
    expect(GUEST_MAX_PLAYERS).toBe(4);
    expect(MAX_PLAYERS).toBe(12);
    expect(maxPlayersFor(false)).toBe(GUEST_MAX_PLAYERS);
    expect(maxPlayersFor(true)).toBe(MAX_PLAYERS);
  });
});

describe("createTableRequestSchema.maxPlayers", () => {
  const base = { theme: "001", pairs: 8, turnSeconds: 20 };

  it("accepts up to the signed-in cap; the per-viewer cap is enforced by the route", () => {
    expect(createTableRequestSchema.safeParse({ ...base, maxPlayers: 12 }).success).toBe(true);
    expect(createTableRequestSchema.safeParse({ ...base, maxPlayers: 13 }).success).toBe(false);
    expect(createTableRequestSchema.safeParse({ ...base, maxPlayers: 0 }).success).toBe(false);
  });
});

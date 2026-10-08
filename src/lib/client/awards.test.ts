import { describe, expect, it } from "vitest";

import type { PlayerView } from "@/lib/protocol";

import { AWARD_LABEL, computeAwards } from "./awards";

const player = (id: string, over: Partial<PlayerView> = {}): PlayerView => ({
  id,
  name: id,
  seat: 0,
  colour: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: 4,
  pairs: 2,
  streak: 0,
  bestStreak: 1,
  rank: 1,
  ...over,
});

describe("computeAwards", () => {
  it("gives nothing to a solo game", () => {
    expect(computeAwards([player("a", { bestStreak: 8, moves: 8, pairs: 8 })], 8)).toEqual({});
  });

  it("awards the longest streak, shared on a tie, and only from 3 up", () => {
    const awards = computeAwards(
      [player("a", { bestStreak: 4 }), player("b", { bestStreak: 4 }), player("c", { bestStreak: 2 })],
      20,
    );
    expect(awards.a).toContain("streak");
    expect(awards.b).toContain("streak");
    expect(awards.c).toBeUndefined();
    expect(computeAwards([player("a", { bestStreak: 2 }), player("b", { bestStreak: 1 })], 20)).toEqual({});
  });

  it("awards Flawless for a miss-free game of at least 3 pairs, never for an empty one", () => {
    const awards = computeAwards(
      [
        player("a", { pairs: 3, moves: 3 }),
        player("b", { pairs: 0, moves: 0 }),
        player("c", { pairs: 2, moves: 2 }),
      ],
      20,
    );
    expect(awards.a).toContain("flawless");
    expect(awards.b).toBeUndefined();
    expect(awards.c).toBeUndefined();
  });

  it("awards Dominant to more than half of all pairs, not exactly half", () => {
    const awards = computeAwards(
      [player("a", { pairs: 5, moves: 9 }), player("b", { pairs: 5, moves: 9 })],
      10,
    );
    expect(awards).toEqual({});
    const won = computeAwards([player("a", { pairs: 6, moves: 9 }), player("b", { pairs: 4, moves: 9 })], 10);
    expect(won.a).toEqual(["dominant"]);
  });

  it("can give one player several awards", () => {
    const awards = computeAwards(
      [player("a", { pairs: 6, moves: 6, bestStreak: 6 }), player("b", { pairs: 2, moves: 5 })],
      8,
    );
    expect(awards.a).toEqual(["streak", "flawless", "dominant"]);
  });

  it("labels every award", () => {
    expect(AWARD_LABEL).toEqual({ streak: "Longest streak", flawless: "Flawless", dominant: "Dominant" });
  });
});

import { describe, expect, it } from "vitest";

import type { PlayerView, TableView } from "@/lib/protocol";

import { finishMessage } from "./finish-message";

const player = (id: string, name: string, pairs: number, rank: number, moves = 10): PlayerView => ({
  id,
  name,
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves,
  pairs,
  streak: 0,
  bestStreak: 0,
  rank,
});

const view = (players: PlayerView[], youId: string | null, status: TableView["status"] = "finished") =>
  ({ status, pairs: 8, players, youId }) as TableView;

describe("finishMessage", () => {
  const ann = player("a", "Ann", 5, 1);
  const ben = player("b", "Ben", 2, 2);
  const cy = player("c", "Cy", 1, 3);

  it("says nothing until the game is finished", () => {
    expect(finishMessage(view([ann, ben], "a", "playing"))).toBeNull();
  });

  it("celebrates a win with the margin", () => {
    expect(finishMessage(view([ann, ben, cy], "a"))).toMatchObject({ title: "You won!", won: true });
    expect(finishMessage(view([ann, ben, cy], "a"))!.detail).toBe("5 pairs, 3 ahead");
  });

  it("names the place for everyone else and who won", () => {
    expect(finishMessage(view([ann, ben, cy], "b"))).toMatchObject({
      title: "Second place",
      detail: "2 pairs. Ann took the win with 5",
      won: false,
    });
    expect(finishMessage(view([ann, ben, cy], "c"))!.title).toBe("Third place");
  });

  it("handles ties", () => {
    const a = player("a", "Ann", 4, 1);
    const b = player("b", "Ben", 4, 1);
    const c = player("c", "Cy", 0, 3);
    expect(finishMessage(view([a, b, c], "a"))).toMatchObject({ title: "You share the win!", won: true });
    expect(finishMessage(view([a, b, c], "c"))!.detail).toBe("0 pairs. Ann and Ben took the win with 4");
    const d = player("d", "Di", 1, 3);
    expect(finishMessage(view([a, c, d], "c"))!.title).toBe("Tied for third place");
  });

  it("covers solo games and spectators", () => {
    expect(finishMessage(view([player("a", "Ann", 8, 1, 21)], "a"))).toMatchObject({
      title: "All pairs found!",
      detail: "8 pairs in 21 moves",
    });
    expect(finishMessage(view([ann, ben], null))).toMatchObject({
      title: "Ann wins!",
      detail: "with 5 pairs",
    });
  });
});

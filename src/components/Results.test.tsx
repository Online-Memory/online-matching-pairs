// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as ratingHook from "@/lib/client/use-rating-change";
import type { PlayerView, TableView } from "@/lib/protocol";

import { Results } from "./Results";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
  vi.spyOn(ratingHook, "useRatingChange").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = (id: string, over: Partial<PlayerView> = {}): PlayerView => ({
  id,
  name: id.toUpperCase(),
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: 6,
  pairs: 3,
  streak: 0,
  bestStreak: 1,
  rank: 1,
  ...over,
});
const view = (players: PlayerView[], pairs = 8) =>
  ({ code: "ABC234", status: "finished", pairs, players, youId: players[0]!.id }) as unknown as TableView;

describe("Results", () => {
  it("shows the podium and award chips for a versus game", () => {
    render(
      <Results
        view={view([
          player("a", { rank: 1, pairs: 6, moves: 6, bestStreak: 6 }),
          player("b", { rank: 2, pairs: 2, moves: 6 }),
        ])}
      />,
    );
    expect(screen.getByTestId("podium")).toBeInTheDocument();
    const winnerRow = within(screen.getAllByRole("row")[1]!);
    expect(winnerRow.getByText("Longest streak")).toBeInTheDocument();
    expect(winnerRow.getByText("Flawless")).toBeInTheDocument();
    expect(winnerRow.getByText("Dominant")).toBeInTheDocument();
  });

  it("has no podium and no awards in a solo game", () => {
    render(<Results view={view([player("a", { pairs: 8, moves: 8, bestStreak: 8 })])} />);
    expect(screen.queryByTestId("podium")).toBeNull();
    expect(screen.queryByText("Flawless")).toBeNull();
  });
});

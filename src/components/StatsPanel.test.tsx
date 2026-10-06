// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { StatsResponse } from "@/lib/protocol";

import { StatsPanel } from "./StatsPanel";

afterEach(cleanup);

const stats: StatsResponse = {
  games: 12,
  versusGames: 10,
  wins: 4,
  winRate: 0.4,
  bestStreak: 6,
  accuracy: 0.5,
  rating: { value: 1087, ratedGames: 9, rank: 3 },
};

describe("StatsPanel", () => {
  it("shows the rating, rank and the lifetime numbers", () => {
    render(<StatsPanel stats={stats} />);
    const panel = within(screen.getByTestId("stats"));
    expect(panel.getByText("1087")).toBeInTheDocument();
    expect(panel.getByText("#3")).toBeInTheDocument();
    expect(panel.getByText("4 of 10")).toBeInTheDocument();
    expect(panel.getByText("40%")).toBeInTheDocument();
    expect(panel.getByText("50%")).toBeInTheDocument();
    expect(panel.getByText("6")).toBeInTheDocument();
  });

  it("copes with a player who has no rated or versus games", () => {
    render(
      <StatsPanel
        stats={{
          games: 0,
          versusGames: 0,
          wins: 0,
          winRate: null,
          bestStreak: 0,
          accuracy: null,
          rating: null,
        }}
      />,
    );
    const panel = within(screen.getByTestId("stats"));
    expect(panel.getByText("Unrated")).toBeInTheDocument();
    expect(panel.getAllByText("–").length).toBeGreaterThanOrEqual(2);
  });
});

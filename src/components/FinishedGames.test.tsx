// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import type { HistoryEntry, HistoryPage } from "@/lib/protocol";

import { FinishedGames } from "./FinishedGames";

const entry = (
  code: string,
  rank: number | null,
  before: number | null,
  after: number | null,
): HistoryEntry => ({
  code,
  theme: "animals",
  pairs: 8,
  finishedAt: "2026-10-01T12:00:00.000Z",
  you: { pairs: 5, moves: 9, bestStreak: 3, rank, ratingBefore: before, ratingAfter: after },
  players: [
    { name: "Alice", pairs: 5, rank, isYou: true },
    { name: "Bob", pairs: 3, rank: 2, isYou: false },
  ],
});

const page = (entries: HistoryEntry[], total: number, n = 1): HistoryPage => ({
  entries,
  total,
  page: n,
  pageSize: 10,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FinishedGames", () => {
  it("shows an empty state", async () => {
    vi.spyOn(api, "historyPage").mockResolvedValue(page([], 0));
    render(<FinishedGames />);
    expect(await screen.findByText(/No finished games yet/)).toBeInTheDocument();
  });

  it("renders rank and rating change, without a pager for one page", async () => {
    vi.spyOn(api, "historyPage").mockResolvedValue(
      page([entry("AAAA", 1, 1000, 1012), entry("BBBB", null, null, null)], 2),
    );
    render(<FinishedGames />);
    expect(await screen.findByText("1st")).toBeInTheDocument();
    expect(screen.getByText("Played")).toBeInTheDocument();
    expect(screen.getByText(/▲ \+12/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /pages/ })).toBeNull();
  });

  it("pages through games", async () => {
    const spy = vi
      .spyOn(api, "historyPage")
      .mockImplementation(async (n) => page([entry(n === 1 ? "AAAA" : "BBBB", 2, 1000, 990)], 25, n));
    render(<FinishedGames />);
    expect(await screen.findByText(/Page 1 of 3 · 1–10 of 25/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prev/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText(/Page 2 of 3 · 11–20 of 25/)).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith(2, 10);
    expect(screen.getByText(/▼ −10/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";
import type { LeaderboardEntry, LeaderboardResponse } from "@/lib/protocol";

import { Leaderboard } from "./Leaderboard";

const entry = (rank: number, name: string, extra: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  rank,
  handle: name.toLowerCase(),
  name,
  rating: 1200 - rank * 10,
  ratedGames: 3,
  wins: 1,
  isYou: false,
  ...extra,
});
const board = (entries: LeaderboardEntry[], me: LeaderboardEntry | null = null): LeaderboardResponse => ({
  scope: "global",
  entries,
  me,
});
const signedIn = () =>
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  });

beforeEach(() => signedIn());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Leaderboard", () => {
  it("lists players and highlights the viewer's row", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(
      board([entry(1, "Zed"), entry(2, "Alice", { isYou: true })], entry(2, "Alice", { isYou: true })),
    );
    render(<Leaderboard />);
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2
    expect(within(rows[2]!).getByText("@alice")).toBeInTheDocument();
    expect(rows[2]).toHaveClass("you");
  });

  it("shows only the @handle, never the real name", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(
      board([entry(1, "Zed Smith", { handle: "zed" }), entry(2, "Ghost Name", { handle: null })]),
    );
    render(<Leaderboard />);
    expect(await screen.findByText("@zed")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(within(rows[2]!).getByText("Player")).toBeInTheDocument();
    expect(screen.queryByText(/Smith|Ghost Name/)).not.toBeInTheDocument();
  });

  it("shows each player's tier next to their rating", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(board([entry(1, "Zed"), entry(40, "Low")]));
    render(<Leaderboard />);
    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]!).getByText("Gold")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Bronze")).toBeInTheDocument();
  });

  it("pins the viewer's row when it is outside the list", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(
      board([entry(1, "Zed")], entry(57, "Alice", { isYou: true })),
    );
    render(<Leaderboard />);
    const pinned = await screen.findByTestId("my-row");
    expect(within(pinned).getByText("57")).toBeInTheDocument();
  });

  it("says so when nobody is rated yet", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(board([]));
    render(<Leaderboard />);
    expect(await screen.findByText(/No rated games yet/)).toBeInTheDocument();
  });

  it("loads the friends scope when the tab is chosen, and hides it from guests", async () => {
    const spy = vi.spyOn(api, "leaderboard").mockResolvedValue(board([entry(1, "Zed")]));
    render(<Leaderboard />);
    await screen.findByText("@zed");
    fireEvent.click(screen.getByRole("button", { name: "Friends" }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("friends"));

    cleanup();
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    render(<Leaderboard />);
    await screen.findByText("@zed");
    expect(screen.queryByRole("button", { name: "Friends" })).not.toBeInTheDocument();
  });

  it("shows an error when the board cannot be loaded", async () => {
    vi.spyOn(api, "leaderboard").mockRejectedValue(new Error("boom"));
    render(<Leaderboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";

import { Profile } from "./Profile";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/client/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

beforeEach(() => {
  vi.spyOn(api, "historyPage").mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 10 });
  vi.spyOn(api, "stats").mockResolvedValue({
    games: 0,
    versusGames: 0,
    wins: 0,
    winRate: null,
    bestStreak: 0,
    accuracy: null,
    rating: null,
  });
  vi.spyOn(api, "progress").mockResolvedValue({
    xp: 150,
    level: 2,
    xpIntoLevel: 50,
    xpForNext: 200,
    achievements: [{ id: "first_game", earnedAt: "2026-10-07T12:00:00.000Z" }],
  });
  vi.spyOn(api, "colours").mockResolvedValue({ colours: [] });
  vi.spyOn(api, "friends").mockResolvedValue({
    handle: "alice",
    friends: [],
    incoming: [],
    outgoing: [],
    invites: [],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Profile", () => {
  it("shows the preferred colours above friends for a signed-in user", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    render(<Profile />);
    const colours = await screen.findByRole("heading", { name: "Preferred colours" });
    const friends = screen.getByRole("heading", { name: "Friends" });
    expect(colours.compareDocumentPosition(friends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hosts the friends panel for a signed-in user, above the finished games", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    render(<Profile />);
    const friends = await screen.findByRole("heading", { name: "Friends" });
    const games = screen.getByRole("heading", { name: "Finished games" });
    expect(friends.compareDocumentPosition(games) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the stats panel above friends for a signed-in user", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    render(<Profile />);
    const stats = await screen.findByTestId("stats");
    const friends = screen.getByRole("heading", { name: "Friends" });
    expect(stats.compareDocumentPosition(friends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still renders the profile when stats fail to load", async () => {
    vi.spyOn(api, "stats").mockRejectedValue(new Error("boom"));
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    render(<Profile />);
    expect(await screen.findByRole("heading", { name: "Friends" })).toBeInTheDocument();
    expect(screen.queryByTestId("stats")).not.toBeInTheDocument();
  });

  it("shows the level bar, and still renders when progress fails to load", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    const { unmount } = render(<Profile />);
    expect(await screen.findByText("Level 2")).toBeInTheDocument();
    unmount();

    vi.spyOn(api, "progress").mockRejectedValue(new Error("boom"));
    render(<Profile />);
    expect(await screen.findByRole("heading", { name: "Friends" })).toBeInTheDocument();
    expect(screen.queryByText(/^Level /)).toBeNull();
  });

  it("shows the achievements panel for a signed-in user", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    render(<Profile />);
    expect(await screen.findByRole("heading", { name: "Achievements" })).toBeInTheDocument();
    expect(screen.getByText("1 of 7 earned")).toBeInTheDocument();
  });

  it("copes with an older server that sends no achievements", async () => {
    vi.spyOn(api, "progress").mockResolvedValue({ xp: 0, level: 1, xpIntoLevel: 0, xpForNext: 100 });
    vi.spyOn(meModule, "useMe").mockReturnValue({
      authEnabled: true,
      user: { id: "a", name: "Alice", email: "a@example.com", image: null },
    });
    render(<Profile />);
    expect(await screen.findByText("0 of 7 earned")).toBeInTheDocument();
  });

  it("has no friends for a guest", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    render(<Profile />);
    expect(screen.queryByRole("heading", { name: "Friends" })).toBeNull();
    expect(api.friends).not.toHaveBeenCalled();
  });
});

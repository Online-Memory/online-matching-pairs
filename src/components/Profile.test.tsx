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

  it("has no friends for a guest", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    render(<Profile />);
    expect(screen.queryByRole("heading", { name: "Friends" })).toBeNull();
    expect(api.friends).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";

import { Profile } from "./Profile";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/client/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

beforeEach(() => {
  vi.spyOn(api, "history").mockResolvedValue([]);
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

  it("has no friends for a guest", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    render(<Profile />);
    expect(screen.queryByRole("heading", { name: "Friends" })).toBeNull();
    expect(api.friends).not.toHaveBeenCalled();
  });
});

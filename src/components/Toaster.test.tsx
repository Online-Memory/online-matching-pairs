// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import { refreshFriends } from "@/lib/client/use-friends";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse, MeResponse } from "@/lib/protocol";

import { Toaster } from "./Toaster";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const signedIn: MeResponse = {
  authEnabled: true,
  user: { id: "a", name: "Alice", email: null, image: null },
};
const base: FriendsResponse = { handle: "alice", friends: [], incoming: [], outgoing: [], invites: [] };
const dave = { userId: "d", handle: "dave", name: "Dave" };
const invite = {
  id: "i1",
  tableCode: "ABC234",
  fromName: "Bob",
  fromHandle: "bob",
} as FriendsResponse["invites"][number];

beforeEach(() => {
  pathname = "/";
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Toaster", () => {
  it("does not announce what is already pending on first load", async () => {
    const friends = vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave] });
    render(<Toaster />);
    await vi.waitFor(() => expect(friends).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/wants to be your friend/)).toBeNull();
  });

  it("pops up a friend request and a table invite that arrive later", async () => {
    const friends = vi.spyOn(api, "friends").mockResolvedValue(base);
    render(<Toaster />);
    await vi.waitFor(() => expect(friends).toHaveBeenCalled());
    await act(async () => {});

    friends.mockResolvedValue({ ...base, incoming: [dave], invites: [invite] });
    await act(() => refreshFriends());

    expect(await screen.findByText(/Dave \(@dave\) wants to be your friend/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/profile");
    expect(screen.getByText(/Bob \(@bob\) invited you to a table/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join ABC234" })).toHaveAttribute("href", "/table/ABC234?join=1");

    // A repeat poll with the same items does not pop them up again.
    fireEvent.click(screen.getAllByRole("button", { name: "Close notification" })[0]!);
    await act(() => refreshFriends());
    await vi.waitFor(() => expect(screen.queryByText(/Dave \(@dave\)/)).toBeNull());
  });

  it("closes itself after a few seconds", async () => {
    const friends = vi.spyOn(api, "friends").mockResolvedValue(base);
    render(<Toaster />);
    await vi.waitFor(() => expect(friends).toHaveBeenCalled());
    await act(async () => {});
    vi.useFakeTimers(); // before the popup appears, so its timeout is the fake one
    friends.mockResolvedValue({ ...base, incoming: [dave] });
    await act(() => refreshFriends());
    expect(screen.getByText(/Dave/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(/Dave/).closest("li")).toHaveAttribute("data-leaving", "true"); // fading out
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText(/Dave/)).toBeNull();
  });

  it("stays quiet during a game", async () => {
    pathname = "/table/ABC234";
    const friends = vi.spyOn(api, "friends").mockResolvedValue(base);
    const { container } = render(<Toaster />);
    await vi.waitFor(() => expect(friends).toHaveBeenCalled());
    await act(async () => {});
    friends.mockResolvedValue({ ...base, incoming: [dave] });
    await act(() => refreshFriends());
    expect(container).toBeEmptyDOMElement();
  });
});

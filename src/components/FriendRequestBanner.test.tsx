// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import { refreshFriends } from "@/lib/client/use-friends";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse, MeResponse } from "@/lib/protocol";

import { FriendRequestBanner } from "./FriendRequestBanner";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const signedIn: MeResponse = {
  authEnabled: true,
  user: { id: "a", name: "Alice", email: null, image: null },
};
const base: FriendsResponse = { handle: "alice", friends: [], incoming: [], outgoing: [], invites: [] };
const dave = { userId: "d", handle: "dave", name: "Dave" };
const erin = { userId: "e", handle: "erin", name: "Erin" };

beforeEach(() => {
  pathname = "/";
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FriendRequestBanner", () => {
  it("announces a friend request with accept and decline", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave] });
    const accept = vi.spyOn(api, "acceptFriend").mockResolvedValue({ ok: true });
    const decline = vi.spyOn(api, "removeFriend").mockResolvedValue({ ok: true });
    render(<FriendRequestBanner />);

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Dave");
    expect(banner).toHaveTextContent("@dave");
    expect(banner).toHaveTextContent(/wants to be your friend/i);

    fireEvent.click(screen.getByRole("button", { name: /^Accept/ }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("d"));
    fireEvent.click(screen.getByRole("button", { name: /^Decline/ }));
    await waitFor(() => expect(decline).toHaveBeenCalledWith("d"));
  });

  it("shows how many more are waiting and links to the profile", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave, erin] });
    render(<FriendRequestBanner />);
    expect(await screen.findByRole("link", { name: /1 more/ })).toHaveAttribute("href", "/profile");
  });

  it("stays away after Later for this visit, even when a new poll lands", async () => {
    const friends = vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave] });
    render(<FriendRequestBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).toBeNull();

    await act(() => refreshFriends());
    expect(friends).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("comes back when the app is opened again and the request is still pending", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave] });
    render(<FriendRequestBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).toBeNull();

    cleanup(); // closing the tab or reloading
    render(<FriendRequestBanner />);
    expect(await screen.findByRole("status")).toHaveTextContent("Dave");
  });

  it("shows a request that arrives after Later", async () => {
    const friends = vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave] });
    render(<FriendRequestBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));

    friends.mockResolvedValue({ ...base, incoming: [dave, erin] });
    await act(() => refreshFriends());
    expect(await screen.findByRole("status")).toHaveTextContent("Erin");
  });

  it("is hidden on a table page and for guests", async () => {
    const friends = vi.spyOn(api, "friends").mockResolvedValue({ ...base, incoming: [dave] });
    pathname = "/table/ABC234";
    const { container } = render(<FriendRequestBanner />);
    await waitFor(() => expect(friends).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    cleanup();
    pathname = "/";
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const guest = render(<FriendRequestBanner />);
    expect(guest.container).toBeEmptyDOMElement();
  });
});

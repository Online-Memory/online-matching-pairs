// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse, MeResponse } from "@/lib/protocol";

import { FriendsPanel } from "./FriendsPanel";

const signedIn: MeResponse = {
  authEnabled: true,
  user: { id: "a", name: "Alice", email: null, image: null },
};

const payload: FriendsResponse = {
  handle: "alice",
  friends: [
    {
      userId: "c",
      handle: "carol",
      name: "Carol",
      online: false,
      lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    { userId: "b", handle: "bob", name: "Bob", online: true, lastSeenAt: new Date().toISOString() },
  ],
  incoming: [{ userId: "d", handle: "dave", name: "Dave" }],
  outgoing: [],
  invites: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      tableCode: "ABC234",
      fromName: "Bob",
      fromHandle: "bob",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  ],
};

beforeEach(() => {
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
  vi.spyOn(api, "friends").mockResolvedValue(payload);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FriendsPanel", () => {
  it("lists online friends first with a status, plus requests and invites", async () => {
    render(<FriendsPanel />);
    const bob = await screen.findByRole("listitem", { name: "Bob" });
    expect(bob).toHaveTextContent(/online/i);
    const items = screen.getAllByRole("listitem", { name: /^(Bob|Carol)$/ });
    expect(items.map((li) => li.getAttribute("aria-label"))).toEqual(["Bob", "Carol"]);
    expect(screen.getByRole("listitem", { name: "Carol" })).toHaveTextContent(/last seen/i);
    expect(screen.getByRole("button", { name: "Accept Dave (@dave)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Join ABC234/ })).toHaveAttribute("href", "/table/ABC234");
    const invites = screen.getByRole("list", { name: "Table invites" });
    expect(invites).toHaveTextContent("Bob");
    expect(invites).toHaveTextContent("@bob");
    expect(invites).toHaveTextContent("invited you");
  });

  it("labels same-named friends by handle so they can be told apart", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({
      ...payload,
      friends: [
        { userId: "s1", handle: "sam_lee", name: "Sam", online: true, lastSeenAt: new Date().toISOString() },
        { userId: "s2", handle: "sam_ng", name: "Sam", online: true, lastSeenAt: new Date().toISOString() },
      ],
    });
    render(<FriendsPanel />);
    expect(await screen.findByRole("button", { name: "Remove Sam (@sam_lee)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Sam (@sam_ng)" })).toBeInTheDocument();
  });

  it("sends a request by handle and shows the server's error", async () => {
    const send = vi
      .spyOn(api, "sendFriendRequest")
      .mockRejectedValueOnce(new Error("No player with that handle"));
    render(<FriendsPanel />);
    fireEvent.change(await screen.findByLabelText(/friend's handle/i), { target: { value: "@Nobody" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("@Nobody"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No player with that handle");
  });

  it("accepts a request", async () => {
    const accept = vi.spyOn(api, "acceptFriend").mockResolvedValue({ ok: true });
    render(<FriendsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept Dave (@dave)" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("d"));
  });

  it("uses the app's field styling for both inputs", async () => {
    render(<FriendsPanel />);
    const add = await screen.findByLabelText(/friend's handle/i);
    expect(add.closest(".field")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change handle" }));
    expect(screen.getByLabelText("New handle").closest(".field")).not.toBeNull();
  });

  it("changes your handle from an inline editor", async () => {
    const set = vi.spyOn(api, "setHandle").mockResolvedValue({ handle: "ally" });
    render(<FriendsPanel />);
    expect(screen.queryByLabelText("New handle")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Change handle" }));
    fireEvent.change(screen.getByLabelText("New handle"), { target: { value: "ally" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("ally"));
    await waitFor(() => expect(screen.queryByLabelText("New handle")).toBeNull());
  });

  it("shows an empty state when there are no friends", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...payload, friends: [], incoming: [], invites: [] });
    render(<FriendsPanel />);
    expect(await screen.findByText(/No friends yet/)).toBeInTheDocument();
  });

  it("renders nothing for guests", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const { container } = render(<FriendsPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(api.friends).not.toHaveBeenCalled();
  });
});

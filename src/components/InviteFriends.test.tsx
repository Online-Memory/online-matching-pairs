// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse } from "@/lib/protocol";

import { InviteFriends } from "./InviteFriends";

const seen = new Date().toISOString();
const payload: FriendsResponse = {
  handle: "alice",
  friends: [
    { userId: "b", handle: "bob", name: "Bob", online: true, inGame: false, lastSeenAt: seen },
    { userId: "c", handle: "carol", name: "Carol", online: false, inGame: false, lastSeenAt: seen },
  ],
  incoming: [],
  outgoing: [],
  invites: [],
};

beforeEach(() => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  });
  vi.spyOn(api, "friends").mockResolvedValue(payload);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InviteFriends", () => {
  it("offers only online friends and marks them invited", async () => {
    const invite = vi.spyOn(api, "inviteFriend").mockResolvedValue({ ok: true });
    render(<InviteFriends code="ABC234" />);
    fireEvent.click(await screen.findByRole("button", { name: "Invite Bob (@bob)" }));
    await waitFor(() => expect(invite).toHaveBeenCalledWith("ABC234", "b"));
    expect(await screen.findByRole("button", { name: "Invited" })).toBeDisabled();
    expect(screen.queryByText(/Carol/)).toBeNull();
  });

  it("does not offer friends who are already in a game", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({
      ...payload,
      friends: [
        { userId: "b", handle: "bob", name: "Bob", online: true, inGame: true, lastSeenAt: seen },
        { userId: "d", handle: "dan", name: "Dan", online: true, inGame: false, lastSeenAt: seen },
      ],
    });
    render(<InviteFriends code="ABC234" />);
    expect(await screen.findByRole("button", { name: "Invite Dan (@dan)" })).toBeEnabled();
    expect(screen.queryByText(/Bob/)).toBeNull();
  });

  it("hides the picker when every online friend is in a game", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({
      ...payload,
      friends: [{ userId: "b", handle: "bob", name: "Bob", online: true, inGame: true, lastSeenAt: seen }],
    });
    render(<InviteFriends code="ABC234" />);
    await waitFor(() => expect(api.friends).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Invite friends" })).toBeNull();
  });

  it("tells same-named friends apart by handle", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({
      ...payload,
      friends: [
        { userId: "s1", handle: "sam_lee", name: "Sam", online: true, inGame: false, lastSeenAt: seen },
        { userId: "s2", handle: "sam_ng", name: "Sam", online: true, inGame: false, lastSeenAt: seen },
      ],
    });
    render(<InviteFriends code="ABC234" />);
    expect(await screen.findByRole("button", { name: "Invite Sam (@sam_lee)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite Sam (@sam_ng)" })).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    vi.spyOn(api, "inviteFriend").mockRejectedValue(new Error("You are not seated at that lobby"));
    render(<InviteFriends code="ABC234" />);
    fireEvent.click(await screen.findByRole("button", { name: "Invite Bob (@bob)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not seated");
  });

  it("renders nothing when no friend is online", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...payload, friends: [payload.friends[1]!] });
    const { container } = render(<InviteFriends code="ABC234" />);
    await waitFor(() => expect(api.friends).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
